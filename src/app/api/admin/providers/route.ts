import { NextRequest, NextResponse } from "next/server";
import { getAllProviders, createProvider } from "@/engine/data-access/providers";

export async function GET() {
  try {
    const providers = await getAllProviders();
    return NextResponse.json(providers);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, baseUrl, apiFormat, notes } = body;

    if (!name || !baseUrl || !apiFormat) {
      return NextResponse.json(
        { error: "name, baseUrl, and apiFormat are required" },
        { status: 400 }
      );
    }

    if (!["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"].includes(apiFormat)) {
      return NextResponse.json(
        { error: "apiFormat must be CHAT_COMPLETIONS, MESSAGES, or RESPONSES" },
        { status: 400 }
      );
    }

    const provider = await createProvider({ name, baseUrl, apiFormat, notes });
    return NextResponse.json(provider, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
