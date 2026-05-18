import { NextRequest, NextResponse } from "next/server";
import {
  getFrontpage,
  getAllFrontpageInfo,
  getFrontpageSourceIds,
} from "@/lib/frontpages";

export const runtime = "nodejs";

// i'm not entirely sure that this feature is needed, 
// but i'll add it for now due to the request from a user
// documenting to the best of my ability

/**
 * GET /api/frontpage
 * Returns list of sources with frontpage support and their available sections
 */
export async function GET() {
  try {
    const frontpages = getAllFrontpageInfo();
    return NextResponse.json({
      sources: frontpages,
      sourceIds: getFrontpageSourceIds(),
    });
  } catch (error: unknown) {
    console.error("[Frontpage] Error getting frontpage info:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get frontpage info" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/frontpage
 * Fetch frontpage section data
 *
 * Request body:
 * {
 *   source: string;      // Source ID (e.g., "comix")
 *   section: string;     // Section ID (e.g., "trending", "latest_hot")
 *   page?: number;       // Page number (default: 1)
 *   limit?: number;      // Items per page (default: 30)
 *   days?: number;       // Time filter in days (for trending/most_followed, default: 7)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, section, page, limit, days } = body;

    if (!source) {
      return NextResponse.json(
        { error: "Source is required" },
        { status: 400 }
      );
    }

    if (!section) {
      return NextResponse.json(
        { error: "Section is required" },
        { status: 400 }
      );
    }

    const frontpage = getFrontpage(source);
    if (!frontpage) {
      const availableSources = getFrontpageSourceIds();
      return NextResponse.json(
        {
          error: `Source "${source}" does not have frontpage support. Available sources: ${availableSources.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const availableSections = frontpage.getAvailableSections();
    const sectionConfig = availableSections.find((s) => s.id === section);
    if (!sectionConfig) {
      return NextResponse.json(
        {
          error: `Unknown section "${section}". Available sections: ${availableSections.map((s) => s.id).join(", ")}`,
        },
        { status: 400 }
      );
    }

    console.log(
      `[Frontpage] Fetching ${source}/${section} (page: ${page || 1}, limit: ${limit || 30}, days: ${days || 7})`
    );

    const sectionData = await frontpage.fetchSection(section, {
      page: page || 1,
      limit: limit || 30,
      days: days || 7,
    });

    return NextResponse.json({
      source: frontpage.getSourceId(),
      sourceName: frontpage.getSourceName(),
      section: sectionData,
      fetchedAt: Date.now(),
    });
  } catch (error: unknown) {
    console.error("[Frontpage] Error fetching section:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch frontpage section" },
      { status: 500 }
    );
  }
}
