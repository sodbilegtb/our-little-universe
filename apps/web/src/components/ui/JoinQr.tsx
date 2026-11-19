import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/cn';

interface JoinQrProps {
  url: string;
  size: number;
  className?: string;
}

/** The QR code on an ivory plate. Dark-on-light keeps it reliably scannable from across a room. */
export function JoinQr({ url, size, className }: JoinQrProps) {
  const padding = Math.round(size * 0.09);
  return (
    <div
      role="img"
      aria-label="QR code to join the celebration"
      className={cn('rounded-[2rem] bg-paper shadow-[0_30px_120px_-30px_rgba(216,189,139,0.55)]', className)}
      style={{ padding }}
    >
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        marginSize={0}
        fgColor="#2A2531"
        bgColor="#FAF7F0"
        title="Scan to join the celebration"
      />
    </div>
  );
}

export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** The server knows the public URL once deployed; locally the TV's own origin is right. */
export function resolveJoinUrl(fromServer: string): string {
  return fromServer || `${window.location.origin}/party`;
}
