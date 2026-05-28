export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

export type PushGateway = {
  send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void>;
};
