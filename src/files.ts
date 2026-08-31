import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

export function productDirectory(uin: string): string {
  return join(tmpdir(), "ksp-cli", uin);
}

export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
