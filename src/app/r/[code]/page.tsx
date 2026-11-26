import RoomView from "@/components/RoomView";

export default async function GuestRoom({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomView code={code.toUpperCase()} />;
}
