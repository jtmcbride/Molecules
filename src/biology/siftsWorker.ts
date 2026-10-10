import { readSifts } from "../data/sifts";
self.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; entryId: string }>,
) => {
  try {
    const result = await readSifts(event.data.bytes, event.data.entryId);
    self.postMessage({ type: "result", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "SIFTS parsing failed.",
    });
  }
};
