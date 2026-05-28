export type PushSubscription = {
  id: string;
  clinicId: string;
  userEmail: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
};
