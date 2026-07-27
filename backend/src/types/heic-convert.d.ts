declare module "heic-convert" {
  type ConvertInput = {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };
  export default function convert(input: ConvertInput): Promise<ArrayBuffer>;
}
