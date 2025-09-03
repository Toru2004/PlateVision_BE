import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/payment-create-url.dto';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create')
  async createPayment(@Body() dto: CreatePaymentDto) {
    const paymentUrl = await this.paymentService.createPaymentUrl(dto);
    return { paymentUrl };
  }

  @Get('vnpay_return')
  async vnpayReturn(@Query() query: any) {
    return await this.paymentService.verifyReturnUrl(query);
  }
}
