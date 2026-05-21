export type FollowUp = {
  id: string;
  clinicId: string;
  leadId: string;
  dueAt: Date;
  status: "pending" | "done" | "cancelled" | "expired";
  reason: string;
  suggestedMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

