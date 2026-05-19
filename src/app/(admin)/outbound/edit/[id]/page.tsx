import OutboundEntry from "@/components/purchase/OutboundEntry";

export default async function OutboundEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OutboundEntry editId={Number(id)} />;
}
