import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService as NestConfigService } from '@nestjs/config';
import { ConfigService } from './config/config.service';
import { NotificationModule } from './notification/notification.module';
import { FirebaseAdminProvider } from './common/firebase-admin.provider';
import { FirebaseAdminModule } from './common/firebase-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // MongooseModule.forRootAsync({
    //   imports: [ConfigModule],
    //   useFactory: async (configService: NestConfigService) => {
    //     const uri = configService.get<string>('MONGO_URI');
    //     return { uri };
    //   },
    //   inject: [NestConfigService],
    // }),
    // ConfigModule,
    NotificationModule,
    FirebaseAdminModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
