import { Globe, Mail } from "lucide-react";
import { CHANNEL_LABEL } from "@/lib/format";

/**
 * Each platform's own mark and colour, so staff can tell at a glance where a
 * guest wrote from. Colour is never the only signal: the name is always in a
 * tooltip or next to it.
 */
export const CHANNEL_BRAND: Record<string, { bg: string; bar: string; tint: string; text: string }> = {
  airbnb: { bg: "bg-[#FF5A5F]", bar: "bg-[#FF5A5F]", tint: "bg-[#FF5A5F]/10", text: "text-[#E0484D]" },
  booking_com: { bg: "bg-[#003580]", bar: "bg-[#003580]", tint: "bg-[#003580]/10", text: "text-[#003580]" },
  whatsapp: { bg: "bg-[#25D366]", bar: "bg-[#25D366]", tint: "bg-[#25D366]/10", text: "text-[#128C4B]" },
  gmail: { bg: "bg-[#EA4335]", bar: "bg-[#EA4335]", tint: "bg-[#EA4335]/10", text: "text-[#C5221F]" },
  beds24: { bg: "bg-slate-600", bar: "bg-slate-400", tint: "bg-slate-100", text: "text-slate-700" },
};

export const brandOf = (channel: string) => CHANNEL_BRAND[channel] ?? CHANNEL_BRAND.beds24;

const AIRBNB =
  "M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z";

const WHATSAPP =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z";

/** The platform's mark (white) — place it on brandOf(channel).bg. */
export function ChannelMark({ channel, className = "h-3 w-3" }: { channel: string; className?: string }) {
  if (channel === "airbnb" || channel === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <path d={channel === "airbnb" ? AIRBNB : WHATSAPP} />
      </svg>
    );
  }
  if (channel === "booking_com") {
    return (
      <span aria-hidden="true" className="font-sans leading-none font-extrabold tracking-tighter" style={{ fontSize: "0.7em" }}>
        B<span className="text-[#5BBAFF]">.</span>
      </span>
    );
  }
  if (channel === "gmail") return <Mail aria-hidden="true" className={className} strokeWidth={2.5} />;
  return <Globe aria-hidden="true" className={className} strokeWidth={2.5} />;
}

/** A round logo in the platform's colour. */
export function ChannelLogo({ channel, size = "md" }: { channel: string; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "h-4 w-4 text-[11px]", md: "h-5 w-5 text-[13px]", lg: "h-7 w-7 text-[17px]" }[size];
  const mark = { sm: "h-2.5 w-2.5", md: "h-3 w-3", lg: "h-4 w-4" }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${brandOf(channel).bg} ${box}`}
      title={CHANNEL_LABEL[channel] ?? channel}
    >
      <ChannelMark channel={channel} className={mark} />
    </span>
  );
}
