import InboundEntry from "@/components/purchase/InboundEntry";

export default async function InboundEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InboundEntry editId={Number(id)} />;
}
