import QRCode from "qrcode";
import RoomView from "@/components/RoomView";
import { appUrl, normaliseCode } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function HostRoom({ params }: { params: Promise<{ code: string }> }) {
  const code = normaliseCode((await params).code);
  const joinUrl = `${appUrl()}/r/${code}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

  return (
    <RoomView
      code={code}
      invite={{ joinUrl, qrSvg, displayUrl: joinUrl.replace(/^https?:\/\//, "") }}
    />
  );
}
