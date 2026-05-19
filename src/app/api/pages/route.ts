import { NextRequest, NextResponse } from "next/server";
import { getScraperByName, getAllScrapers } from "@/lib/scrapers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { url, source } = await request.json();
    if (!url) return NextResponse.json({ error: "Chapter URL is required" }, { status: 400 });
    let scraper;
    if (source) {
      scraper = getScraperByName(source);
    } else {
      scraper = getAllScrapers().find((s) => s.canHandle(url));
    }
    if (!scraper) return NextResponse.json({ error: "No scraper found for this URL" }, { status: 400 });
    const pages = await scraper.getChapterPages(url);
    return NextResponse.json({ pages, source: scraper.getName(), total: pages.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get pages" },
      { status: 500 }
    );
  }
}