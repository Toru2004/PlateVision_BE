import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationListener implements OnModuleInit, OnModuleDestroy {
  private previousCanhbao: Record<string, boolean> = {};
  private currentTimeEnd: Date | null = null; // mốc hạn chung
  private intervalId: NodeJS.Timeout | null = null;
  private notifiedBefore30m = false; // tránh gửi lặp lại

  // Múi giờ VN
  private static readonly VN_TZ = 'Asia/Ho_Chi_Minh';
  private static readonly VN_OFFSET_MINUTES = 7 * 60; // +07:00

  constructor(
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    const realtimeDb = getDatabase(this.firebaseApp);
    const firestore = getFirestore(this.firebaseApp);

    /** Quan sát biensotrongbai */
    const biensotrongbaiRef = realtimeDb.ref('biensotrongbai');
    biensotrongbaiRef.on('child_changed', async (snapshot) => {
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

            for (const doc of querySnapshot.docs) {
              const userData = doc.data();
              const fcmTokens: string[] = userData.fcmTokens ?? [];
              if (!fcmTokens.length) continue;

              await this.notificationService.sendPush({
                deviceId: fcmTokens,
                title: '🚨 Cảnh báo xe',
                body: `Bạn đang chuẩn bị ra khỏi nhà xe đúng không?`,
              });
            }
          } catch (error) {
            console.error(`Lỗi khi truy vấn firestore:`, error);
          }
        }
      } else if (typeof currentExpiredTime === 'string') {
        const now = new Date();
        const THIRTY_MINUTES_MS = 30 * 60 * 1000;

        const expiredDate = new Date(currentExpiredTime.replace(' ', 'T'));
        if (isNaN(expiredDate.getTime())) {
          console.warn(`⚠️ expiredTime không hợp lệ: ${currentExpiredTime}`);
          return;
        }

        const remaining = expiredDate.getTime() - now.getTime();
        if (remaining <= THIRTY_MINUTES_MS && remaining > 0) {
          console.log(
            `⏰ Biển số ${biensoxe} sắp hết hạn trong ${Math.floor(remaining / 60000)} phút`,
          );

          try {
            const querySnapshot = await firestore
              .collection('thongtindangky')
              .where('biensophu.bienSo', '==', biensoxe)
              .get();

            if (querySnapshot.empty) {
              console.warn(`Không tìm thấy user có biển phụ: ${biensoxe}`);
              return;
            }

            for (const doc of querySnapshot.docs) {
              const userData = doc.data();
              const fcmTokens: string[] = userData.fcmTokens ?? [];
              if (!fcmTokens.length) continue;

              await this.notificationService.sendPush({
                deviceId: fcmTokens,
                title: '⏰ Biển phụ sắp hết hạn',
                body: `Biển số phụ ${biensoxe} sẽ hết hạn sau 30 phút nữa.`,
              });
            }
          } catch (error) {
            console.error(`Lỗi khi gửi thông báo hết hạn:`, error);
          }
        }
      }
    });

    /** Quan sát TimeEnd (hạn chung của bãi - format HH:mm:ss) */
    const refTimeEnd = realtimeDb.ref('TimeEnd');
    refTimeEnd.on('value', async (snapshot) => {
      const newTimeEndStr: string = snapshot.val();
      if (!newTimeEndStr) {
        console.log("⚠️ TimeEnd bị xoá hoặc null");
        this.currentTimeEnd = null;

        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
        return;
      }

      const parsed = parseTimeEndVN(newTimeEndStr);
      if (!parsed) {
        console.warn(`⚠️ TimeEnd không hợp lệ: ${newTimeEndStr}`);
        return;
      }

      this.currentTimeEnd = parsed;
      this.notifiedBefore30m = false; // reset khi có TimeEnd mới

      console.log(
        `🔔 TimeEnd mới | VN: ${formatVN(this.currentTimeEnd)} | UTC: ${this.currentTimeEnd.toISOString()}`,
      );

      // Clear interval cũ
      if (this.intervalId) clearInterval(this.intervalId);

      // Kiểm tra mỗi phút
      this.intervalId = setInterval(async () => {
        if (!this.currentTimeEnd) return;

        const now = new Date();
        const diffMs = this.currentTimeEnd.getTime() - now.getTime();
        const diffMin = Math.floor(diffMs / 60000);

        try {
          // Thông báo trước 30 phút
          if (diffMin === 30 && !this.notifiedBefore30m) {
            console.log(`⏰ Còn 30 phút nữa đến hạn TimeEnd: ${formatVN(this.currentTimeEnd)}`);
            this.notifiedBefore30m = true;

            const rtSnapshot = await biensotrongbaiRef.once('value');
            const biensotrongbai = rtSnapshot.val() || {};

            for (const biensoxe of Object.keys(biensotrongbai)) {
              const querySnapshot = await firestore
                .collection('thongtindangky')
                .where('biensoxe', '==', biensoxe)
                .get();

              for (const doc of querySnapshot.docs) {
                const userData = doc.data();
                const fcmTokens: string[] = userData.fcmTokens ?? [];
                if (!fcmTokens.length) continue;

                await this.notificationService.sendPush({
                  deviceId: fcmTokens,
                  title: '📢 Sắp đến hạn gửi xe',
                  body: `Xe ${biensoxe} còn 30 phút nữa sẽ đến hạn ra bãi (${newTimeEndStr}).`,
                });
              }
            }
          }

          // Thông báo quá hạn
          if (now.getTime() >= this.currentTimeEnd.getTime()) {
            console.log(
              `⏰ Đã quá hạn TimeEnd | VN: ${formatVN(this.currentTimeEnd)} | UTC: ${this.currentTimeEnd.toISOString()}`,
            );

            const rtSnapshot = await biensotrongbaiRef.once('value');
            const biensotrongbai = rtSnapshot.val() || {};

            for (const biensoxe of Object.keys(biensotrongbai)) {
              const querySnapshot = await firestore
                .collection('thongtindangky')
                .where('biensoxe', '==', biensoxe)
                .get();

              for (const doc of querySnapshot.docs) {
                const userData = doc.data();
                const fcmTokens: string[] = userData.fcmTokens ?? [];
                if (!fcmTokens.length) continue;

                await this.notificationService.sendPush({
                  deviceId: fcmTokens,
                  title: '⏰ Quá hạn ra bãi',
                  body: `Xe ${biensoxe} đã vượt quá hạn ra bãi (${newTimeEndStr}).`,
                });
              }
            }

            clearInterval(this.intervalId!);
            this.intervalId = null;
          }
        } catch (error) {
          console.error(`❌ Lỗi khi gửi thông báo TimeEnd:`, error);
        }
      }, 60 * 1000);
    });

    /** ===== Helpers ===== */

    function parseTimeEndVN(timeEnd: string): Date | null {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(timeEnd)) return null;

      const [h, m, s] = timeEnd.split(':').map(Number);

      // Lấy "hôm nay" theo múi giờ VN
      const now = new Date();
      const tzNow = new Date(now.getTime() + NotificationListener.VN_OFFSET_MINUTES * 60_000);
      const y = tzNow.getUTCFullYear();
      const mon = tzNow.getUTCMonth();
      const d = tzNow.getUTCDate();

      // Convert về UTC
      const utcMs = Date.UTC(y, mon, d, h, m, s) - NotificationListener.VN_OFFSET_MINUTES * 60_000;
      return new Date(utcMs);
    }

    function formatVN(date: Date): string {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: NotificationListener.VN_TZ,
        dateStyle: 'short',
        timeStyle: 'medium',
        hour12: false,
      }).format(date);
    }
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
