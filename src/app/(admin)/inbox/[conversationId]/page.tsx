import { redirect } from "next/navigation";

export default async function ConversationRedirect({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/app/inbox/${conversationId}`);
}
