import { NextResponse } from "next/server";
import { getAllKeys } from "@/engine/data-access/api-keys";

export async function GET() {
  try {
    const keys = await getAllKeys();
    return NextResponse.json(keys);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
