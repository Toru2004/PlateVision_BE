import { Injectable } from '@nestjs/common';
import { CreatePaymentDto } from './dto/payment-create-url.dto';
import * as crypto from 'crypto';
import * as moment from 'moment';
import { firestore } from 'firebase-admin';
import {
  CreatePaymentOrderDto,
  Currency,
  PaymentOrder,
  PaymentStatus,
} from './dto/payment-order.dto';
@Injectable()
export class PaymentService {
  private vnp_TmnCode = process.env.VNP_TMN_CODE || '';
  private vnp_HashSecret = process.env.VNP_HASH_SECRET || '';
  private vnp_Url = process.env.VNP_URL || '';
  private vnp_ReturnUrl = process.env.VNP_RETURN_URL || '';

  async createPaymentUrl(dto: CreatePaymentDto) {
    const date = new Date();
    const createDate = moment(date).format('YYYYMMDDHHmmss');
    const expireDate = moment(date).add(15, 'minutes').format('YYYYMMDDHHmmss');

    const vnp_TxnRef = Date.now().toString();
    console.log('vnp_TxnRef: ', vnp_TxnRef);
    console.log(
      'vnp: ',
      this.vnp_TmnCode,
      this.vnp_HashSecret,
      this.vnp_Url,
      this.vnp_ReturnUrl,
    );
    const vnp_Params: any = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: this.vnp_TmnCode,
      vnp_Amount: dto.amount * 100, // nhớ nhân 100
      vnp_CurrCode: 'VND',
      vnp_TxnRef: vnp_TxnRef,
      vnp_OrderInfo: 'Thanh toan don hang test',
      vnp_OrderType: 'billpayment',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: this.vnp_ReturnUrl, // cấu hình trong .env
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    };

    //Bước 1: Sort params alphabet
    const sortedKeys = Object.keys(vnp_Params).sort();
    const sortedParams: any = {};
    sortedKeys.forEach((key) => {
      sortedParams[key] = vnp_Params[key];
    });

    //Bước 2: Tạo signData (KHÔNG thêm vnp_SecureHashType vào đây)
    const querystring = require('qs');
    const signData = new URLSearchParams(sortedParams).toString();

    //Bước 3: Ký HMAC SHA512
    const hmac = crypto.createHmac('sha512', this.vnp_HashSecret);
    const vnp_SecureHash = hmac
      .update(Buffer.from(signData, 'utf-8'))
      .digest('hex');

    //Bước 4: Thêm hash vào object
    sortedParams['vnp_SecureHash'] = vnp_SecureHash;

    //(Nếu bạn muốn thêm loại hash type thì thêm ở đây, KHÔNG đưa vào signData)
    sortedParams['vnp_SecureHashType'] = 'SHA512';

    //Bước 5: Tạo URL
    const paymentUrl = `${this.vnp_Url}?${querystring.stringify(sortedParams, { encode: false })}`;
    console.log(paymentUrl);

    //Lưu đơn hàng được tạo lên firestore
    const order: CreatePaymentOrderDto = {
      userid: dto.userId,
      soluot: dto.soluot,
      tongtien: dto.amount,
      loaitien: Currency.VND,
      status: PaymentStatus.PENDING,
      createdAt: firestore.Timestamp.now(),
    };

    await firestore().collection('lichsumualuot').doc(vnp_TxnRef).set(order);

    return await paymentUrl;
  }

  async verifyReturnUrl(query: any) {
    const vnp_SecureHash = query['vnp_SecureHash'];
    const vnp_SecureHashType = query['vnp_SecureHashType'];

    delete query['vnp_SecureHash'];
    delete query['vnp_SecureHashType'];

    const sortedKeys = Object.keys(query).sort();
    const sortedParams: any = {};
    sortedKeys.forEach((key) => {
      sortedParams[key] = query[key];
    });

    // dùng URLSearchParams giống khi tạo URL
    const signData = new URLSearchParams(sortedParams).toString();

    const hmac = crypto.createHmac('sha512', this.vnp_HashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    console.log('signed: ', signed);
    console.log('vnp_SecureHash: ', vnp_SecureHash);

    let paymentOrder: Partial<PaymentOrder> = {
      responseCode: query['vnp_ResponseCode'],
      transactionNo: query['vnp_TransactionNo'],
      updatedAt: firestore.Timestamp.now(),
      payDate: this.parseVnpayDate(query['vnp_PayDate']),
    };

    if (signed === vnp_SecureHash) {
      if (query['vnp_ResponseCode'] === '00') {
        paymentOrder = {
          ...paymentOrder,
          status: PaymentStatus.SUCCESS,
        };
        await this.updateOrderFirestore(query['vnp_TxnRef'], paymentOrder);
        const docRef = firestore()
          .collection('lichsumualuot')
          .doc(query['vnp_TxnRef']);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
          console.log('Không tìm thấy document');
          return null;
        }
        const order = docSnap.data();
        const userId = order?.userid ?? '';
        const luot = order?.soluot ?? 0;
        await this.updateSoLuot(userId, luot);
        return { success: true, message: 'Thanh toán thành công', data: query };
      } else {
        paymentOrder = {
          ...paymentOrder,
          status: PaymentStatus.FAILED,
        };
        await this.updateOrderFirestore(query['vnp_TxnRef'], paymentOrder);

        return { success: false, message: 'Giao dịch thất bại', data: query };
      }
    } else {
      paymentOrder = {
        ...paymentOrder,
        status: PaymentStatus.FAILED,
      };
      await this.updateOrderFirestore(query['vnp_TxnRef'], paymentOrder);
      return { success: false, message: 'Sai chữ ký', data: query };
    }
  }

  async updateOrderFirestore(
    orderid: string,
    orderInfo: Partial<PaymentOrder>,
  ) {
    await firestore()
      .collection('lichsumualuot')
      .doc(orderid)
      .update(orderInfo);
  }

  parseVnpayDate(vnpPayDate: string): firestore.Timestamp {
    // Cắt chuỗi theo định dạng yyyyMMddHHmmss
    const year = parseInt(vnpPayDate.substring(0, 4));
    const month = parseInt(vnpPayDate.substring(4, 6)) - 1; // JS month 0-11
    const day = parseInt(vnpPayDate.substring(6, 8));
    const hour = parseInt(vnpPayDate.substring(8, 10));
    const minute = parseInt(vnpPayDate.substring(10, 12));
    const second = parseInt(vnpPayDate.substring(12, 14));

    const date = new Date(year, month, day, hour, minute, second);

    return firestore.Timestamp.fromDate(date);
  }

  async updateSoLuot(userId: string, soluotmua: number) {
    try {
      const docRef = firestore().collection('thongtindangky').doc(userId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.log('Không tìm thấy document');
        return null;
      }

      const user = docSnap.data();
      const soluot = user?.soluot ?? 0;
      const soluotmoi = soluot + soluotmua;
      await docRef.update({ luot: soluotmoi });

      console.log('User data:', user);
      return { ...user, luot: soluotmoi };
    } catch (error) {
      console.error('Lỗi khi lấy dữ liệu:', error);
      return null;
    }
  }
}
