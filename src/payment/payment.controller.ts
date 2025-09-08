import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/payment-create-url.dto';
import { Response } from 'express';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create')
  async createPayment(@Body() dto: CreatePaymentDto) {
    const paymentUrl = await this.paymentService.createPaymentUrl(dto);
    return { paymentUrl };
  }

  @Get('vnpay_return')
  async vnpayReturn(@Query() query: any, @Res() res: Response) {
    const status = await this.paymentService.verifyReturnUrl(query);

    const appDeepLink = `tramxeuth://payment/result?vnp_ResponseCode=${query['vnp_ResponseCode']}&vnp_TxnRef=${query['vnp_TxnRef']}`;

    return res.redirect(appDeepLink); // <-- sử dụng method redirect
  }
}
