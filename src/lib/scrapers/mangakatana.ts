import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import { ScrapedChapter, SearchResult, SourceType } from "@/types";

export class MangaKatanaScraper extends BaseScraper {
  private readonly BASE_URL = "https://mangakatana.com";

  getName(): string {
    return "MangaKatana";
  }

  getBaseUrl(): string {
    return this.BASE_URL;
  }

  canHandle(url: string): boolean {
    return url.includes("mangakatana.com");
  }

  getType(): SourceType {
    return "aggregator";
  }

  async search(query: string): Promise<SearchResult[]> {
    const searchUrl = `${this.BASE_URL}/?search=${encodeURIComponent(query)}&search_by=book_name`;
    const html = await this.fetchWithRetry(searchUrl);
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $("#book_list .item").each((_, element) => {
      const $item = $(element);
      const $titleLink = $item.find("h3.title a").first();
      const title = $titleLink.text().trim();
      const url = $titleLink.attr("href");
      if (!title || !url) return;

      const urlMatch = url.match(/\/manga\/([^/]+)\.(\d+)/);
      const id = urlMatch ? `${urlMatch[1]}.${urlMatch[2]}` : "";
      if (!id) return;

      const coverImage = $item.find(".wrap_img img").first().attr("src");
      const updateText = $item.find("h3.title span").text().trim();
      const chapterMatch = updateText.match(/chapter\s+(\d+)/i);
      const latestChapter = chapterMatch ? parseFloat(chapterMatch[1]) : 0;
      const lastUpdated = $item.find(".date").first().text().trim();

      results.push({
        id,
        title,
        url,
        coverImage: coverImage || undefined,
        latestChapter,
        lastUpdated,
      });
    });

    return results.slice(0, 5);
  }

  async extractMangaInfo(url: string): Promise<{ title: string; id: string }> {
    const html = await this.fetchWithRetry(url);
    const $ = cheerio.load(html);
    const title =
      $("h1.heading").first().text().trim() ||
      $("title").text().split(" | ")[0].trim();
    const urlMatch = url.match(/\/manga\/([^/]+)\.(\d+)/);
    const id = urlMatch
      ? `${urlMatch[1]}.${urlMatch[2]}`
      : Date.now().toString();

    return { title, id };
  }

  async getChapterList(mangaUrl: string): Promise<ScrapedChapter[]> {
    const html = await this.fetchWithRetry(mangaUrl);
    const $ = cheerio.load(html);
    const chapters: ScrapedChapter[] = [];
    const seenChapterNumbers = new Set<number>();

    $(".chapters table tbody tr").each((_, element) => {
      const $row = $(element);
      const $chapterLink = $row.find(".chapter a").first();
      const href = $chapterLink.attr("href");
      const chapterText = $chapterLink.text().trim();
      if (!href || !chapterText) return;

      const chapterMatch = chapterText.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
      if (!chapterMatch) return;

      const chapterNumber = parseFloat(chapterMatch[1]);
      if (seenChapterNumbers.has(chapterNumber)) return;
      seenChapterNumbers.add(chapterNumber);

      const fullUrl = href.startsWith("http") ? href : `${this.BASE_URL}${href}`;
      const dateText = $row.find(".update_time").text().trim();

      chapters.push({
        id: `${chapterNumber}`,
        number: chapterNumber,
        title: chapterText,
        url: fullUrl,
        lastUpdated: dateText || undefined,
      });
    });

    return chapters.sort((a, b) => a.number - b.number);
  }

  async getChapterPages(chapterUrl: string): Promise<string[]> {
    const html = await this.fetchWithRetry(chapterUrl);
    const $ = cheerio.load(html);
    const pages: string[] = [];

    const addPage = (src?: string) => {
      if (!src || src === "#") return;
      const pageUrl = src.trim();
      if (pageUrl.startsWith("http") && !pages.includes(pageUrl)) {
        pages.push(pageUrl);
      }
    };

    const scriptContent = $("script")
      .toArray()
      .map((el) => $(el).html() || "")
      .join("\n");

    const scriptPageGroups = Array.from(
      scriptContent.matchAll(/var\s+\w+\s*=\s*\[([\s\S]*?)\];/g),
      (match) =>
        Array.from(
          match[1].matchAll(
            /['"](https?:\/\/[^'"]+\.(?:jpg|jpeg|png|webp)(?:\?[^'"]*)?)['"]/gi,
          ),
          (urlMatch) => urlMatch[1],
        ),
    ).filter((urls) => urls.length > 0);

    const bestScriptPages = scriptPageGroups.sort(
      (a, b) => b.length - a.length,
    )[0];

    if (bestScriptPages) {
      bestScriptPages.forEach(addPage);
    }

    $("div#imgs img, .wrap_img img, .chapter-img img").each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).attr("data-src") ||
        $(el).attr("data-lazy-src");
      addPage(src);
    });

    return pages;
  }

  protected override extractChapterNumber(chapterUrl: string): number {
    const match = chapterUrl.match(/\/c(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  }
}
