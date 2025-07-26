import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationListener implements OnModuleInit {
  private previousCanhbao: Record<string, boolean> = {};

  constructor(
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    const realtimeDb = getDatabase(this.firebaseApp);
    const firestore = getFirestore(this.firebaseApp);
    const ref = realtimeDb.ref('biensotrongbai');
    
    ref.on('child_changed', async (snapshot) => {
      const biensoxe = snapshot.key!;
      const data = snapshot.val();
      const currentCanhbao: boolean | null = data.canhbao ?? null;
      const currentExpiredTime: string | null = data.timeExpired ?? null;

      const previous = this.previousCanhbao[biensoxe];
      if (typeof currentCanhbao === 'boolean' && currentCanhbao !== previous) {
        this.previousCanhbao[biensoxe] = currentCanhbao;

        if (currentCanhbao === true) {
          console.log(`🚨 Cảnh báo mới từ biển số: ${biensoxe}`);

          try {
            const querySnapshot = await firestore
              .collection('thongtindangky')
              .where('biensoxe', '==', biensoxe)
              .get();

            if (querySnapshot.empty) {
              console.warn(`Không tìm thấy người dùng có biển số: ${biensoxe}`);
              return;
            }

            querySnapshot.forEach(async (doc) => {
              const userData = doc.data();
              const fcmTokens: string[] = userData.fcmTokens ?? [];

              if (!fcmTokens.length) {
                console.warn(
                  `Không tìm thấy FCM token cho biển số: ${biensoxe}`,
                );
                return;
              }

              await this.notificationService.sendPush({
                deviceId: fcmTokens,
                title: '🚨 Cảnh báo xe',
                body: `Bạn đang chuẩn bị ra khỏi nhà xe đúng không?`,
                // data: {
                //   route: 'thongbao', // hoặc truyền thêm biensoxe nếu cần
                //   biensoxe: biensoxe,
                // },
              });
            });
          } catch (error) {
            console.error(`Lỗi khi truy vấn firestore: ${error}`);
          }
        }
      } else if (typeof currentExpiredTime === 'string') {
        const now = new Date();
        const THIRTY_MINUTES_MS = 30 * 60 * 1000;

        // Parse chuỗi ngày giờ
        const expiredDate = new Date(currentExpiredTime.replace(' ', 'T')); // "2025-07-26 19:40:45" → "2025-07-26T19:40:45"

        if (isNaN(expiredDate.getTime())) {
          console.warn(`⚠️ expiredTime không hợp lệ: ${currentExpiredTime}`);
          return;
        }

        const remaining = expiredDate.getTime() - now.getTime();

        if (remaining <= THIRTY_MINUTES_MS && remaining > 0) {
          console.log(`⏰ Biển số ${biensoxe} sắp hết hạn trong ${Math.floor(remaining / 60000)} phút`);

          try {
            const querySnapshot = await firestore
              .collection('thongtindangky')
              .where('biensophu.bienSo', '==', biensoxe)
              .get();

            if (querySnapshot.empty) {
              console.warn(`Không tìm thấy người dùng có biển phụ: ${biensoxe}`);
              return;
            }

            querySnapshot.forEach(async (doc) => {
              const userData = doc.data();
              console.log(userData.email)
              const fcmTokens: string[] = userData.fcmTokens ?? [];

              if (!fcmTokens.length) {
                console.warn(`Không có FCM token cho biển phụ: ${biensoxe}`);
                return;
              }

              await this.notificationService.sendPush({
                deviceId: fcmTokens,
                title: '⏰ Biển phụ sắp hết hạn',
                body: `Biển số phụ ${biensoxe} sẽ hết hạn sau 30 phút nữa.`,
              });
            });
          } catch (error) {
            console.error(`Lỗi khi gửi thông báo hết hạn: ${error}`);
          }
        }
      }
    });
  }
}
