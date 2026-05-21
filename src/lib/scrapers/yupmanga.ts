import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import { ScrapedChapter, SearchResult, SourceType } from "@/types";

export class YupMangaScraper extends BaseScraper {
  private readonly BASE_URL = "https://www.yupmanga.com";

  getName(): string {
    return "YupManga";
  }

  getBaseUrl(): string {
    return this.BASE_URL;
  }

  canHandle(url: string): boolean {
    return url.includes("yupmanga.com");
  }

  getType(): SourceType {
    return "aggregator";
  }

  async search(query: string): Promise<SearchResult[]> {
    const urls = [
      `${this.BASE_URL}/search.php?q=${encodeURIComponent(query)}`,
      `${this.BASE_URL}/busqueda-avanzada?buscar=${encodeURIComponent(query)}`,
      `${this.BASE_URL}/busqueda_avanzada.php?buscar=${encodeURIComponent(query)}`,
    ];

    for (const url of urls) {
      const html = await this.fetchWithRetry(url);
      const results = this.parseSearchResults(html, query);
      if (results.length > 0) return results.slice(0, 8);
    }

    return [];
  }

  async extractMangaInfo(url: string): Promise<{ title: string; id: string }> {
    const html = await this.fetchWithRetry(url);
    const $ = cheerio.load(html);
    const title =
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.split(" - ")[0].trim() ||
      $("title").text().split(" - ")[0].trim() ||
      "YupManga";

    return { title, id: this.extractSeriesId(url) || this.slugify(title) };
  }

  async getChapterList(mangaUrl: string): Promise<ScrapedChapter[]> {
    const html = await this.fetchWithRetry(mangaUrl);
    const $ = cheerio.load(html);
    const chapters: ScrapedChapter[] = [];
    const seen = new Set<string>();
    const seriesId = this.extractSeriesId(mangaUrl);

    const addChapter = (
      href?: string,
      text?: string,
      fallbackIndex = 0,
      pageCount = 0,
    ) => {
      if (!href) return;
      const fullUrl = this.absoluteUrl(href);
      if (!this.canHandle(fullUrl) || seen.has(fullUrl)) return;
      if (!/leer|chapter|capitulo|capítulo|image-proxy/i.test(fullUrl + " " + (text || ""))) {
        return;
      }

      const number = this.extractChapterNumberFromText(text || fullUrl) || fallbackIndex;
      const id = this.extractChapterId(fullUrl) || `${number || chapters.length + 1}`;
      seen.add(fullUrl);
      chapters.push({
        id,
        number: number || chapters.length + 1,
        title: text?.trim() || `Capitulo ${number || chapters.length + 1}`,
        url: pageCount > 0 ? this.withPageCount(fullUrl, pageCount) : fullUrl,
      });
    };

    if (seriesId) {
      const ajaxUrl = `${this.BASE_URL}/ajax/load_chapters.php?series_id=${encodeURIComponent(seriesId)}&page=1&order=asc`;
      const ajaxResponse = await this.fetchWithRetry(ajaxUrl);
      const data = JSON.parse(ajaxResponse);
      const ajaxHtml = typeof data?.html === "string" ? data.html : "";
      const $ajax = cheerio.load(ajaxHtml);

      $ajax("a.chapter-link[data-chapter]").each((index, element) => {
        const $link = $ajax(element);
        const chapterId = $link.attr("data-chapter");
        const reader = $link.attr("data-reader") || "reader_v2.php";
        const page = $link.attr("data-page") || "1";
        const title = $link.find("img").attr("alt") || $link.find("h3").text();
        const pageCount = parseInt($link.find(".absolute.top-0 span").first().text().trim(), 10) || 0;
        if (!chapterId) return;
        addChapter(
          `${this.BASE_URL}/${reader}?chapter=${encodeURIComponent(chapterId)}&page=${encodeURIComponent(page)}`,
          title,
          index + 1,
          pageCount,
        );
      });

      if (chapters.length > 0) {
        return chapters.sort((a, b) => a.number - b.number);
      }
    }

    $(
      [
        'a[href*="/leer/"]',
        'a[href*="leer.php"]',
        'a[href*="reader_v2.php"]',
        'a[href*="chapter"]',
        'a[href*="capitulo"]',
        'a[href*="capítulo"]',
      ].join(", "),
    ).each((index, element) => {
      const $link = $(element);
      addChapter($link.attr("href"), $link.text(), index + 1);
    });

    const htmlText = $.html();
    for (const match of Array.from(htmlText.matchAll(/image-proxy-v2\.php\?chapter=([A-Z0-9]+)&page=1/gi))) {
      const chapterId = match[1];
      const url = `${this.BASE_URL}/image-proxy-v2.php?chapter=${chapterId}&page=1`;
      if (seen.has(url)) continue;
      seen.add(url);
      chapters.push({
        id: chapterId,
        number: chapters.length + 1,
        title: `Capitulo ${chapters.length + 1}`,
        url,
      });
    }

    return chapters.sort((a, b) => a.number - b.number);
  }

  async getChapterPages(chapterUrl: string): Promise<string[]> {
    const parsedChapterUrl = new URL(chapterUrl, this.BASE_URL);
    const pageCount = parseInt(parsedChapterUrl.searchParams.get("pages") || "", 10);
    const chapterId = parsedChapterUrl.searchParams.get("chapter");

    if (chapterId && pageCount > 0) {
      return Array.from(
        { length: pageCount },
        (_, index) => `${this.BASE_URL}/image-proxy-v2.php?chapter=${encodeURIComponent(chapterId)}&page=${index + 1}`,
      );
    }

    if (chapterUrl.includes("image-proxy-v2.php")) {
      return [this.withoutPageCount(chapterUrl)];
    }

    const html = await this.fetchWithRetry(chapterUrl);
    const $ = cheerio.load(html);
    const pages: string[] = [];
    const seen = new Set<string>();

    const addPage = (src?: string) => {
      if (!src) return;
      const fullUrl = this.absoluteUrl(src.trim());
      if (!this.canHandle(fullUrl) || seen.has(fullUrl)) return;
      if (!/\.(jpg|jpeg|png|webp)(\?|$)|image-proxy/i.test(fullUrl)) return;
      seen.add(fullUrl);
      pages.push(fullUrl);
    };

    $("img").each((_, element) => {
      const $image = $(element);
      addPage(
        $image.attr("data-src") ||
          $image.attr("data-lazy-src") ||
          $image.attr("data-original") ||
          $image.attr("src"),
      );
    });

    for (const match of Array.from(html.matchAll(/["']([^"']*image-proxy-v2\.php\?chapter=[^"']+)["']/gi))) {
      addPage(match[1].replace(/&amp;/g, "&"));
    }

    return pages;
  }

  private parseSearchResults(html: string, query: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    const addResult = (rawUrl?: string, rawTitle?: string, cover?: string, latestChapter = 0) => {
      if (!rawUrl || !rawTitle) return;
      const url = this.absoluteUrl(rawUrl);
      const id = this.extractSeriesId(url);
      const title = rawTitle.trim();
      if (!id || !title || seen.has(id)) return;
      seen.add(id);
      results.push({
        id,
        title,
        url,
        coverImage: cover ? this.absoluteUrl(cover) : undefined,
        latestChapter,
        lastUpdated: "",
      });
    };

    $("script[type='application/ld+json']").each((_, element) => {
      const raw = $(element).contents().text();
      try {
        const data = JSON.parse(raw);
        const items = data?.mainEntity?.itemListElement ?? [];
        for (const entry of items) {
          addResult(entry?.item?.url, entry?.item?.name);
        }
      } catch {}
    });

    $(".comic-card").each((_, element) => {
      const $card = $(element);
      const $link = $card.find('a[href*="series.php?id="]').first();
      const cover = $card.find("img").first().attr("src");
      const title = $card.find("img").first().attr("alt") || $card.find("h3").first().text();
      const latest = parseFloat($card.find(".absolute.top-0 span").first().text().trim()) || 0;
      addResult($link.attr("href"), title, cover, latest);
    });

    $('a[href*="series.php?id="]').each((_, element) => {
      const $link = $(element);
      const $card = $link.closest(".comic-card, article, li, div");
      const title =
        $link.find("img").first().attr("alt") ||
        $link.find("h3").first().text() ||
        $link.text();
      const cover = $link.find("img").first().attr("src") || $card.find("img").first().attr("src");
      addResult($link.attr("href"), title, cover);
    });

    const normalizedQuery = this.normalizeTitle(query);
    return results.filter((result) => this.normalizeTitle(result.title).includes(normalizedQuery));
  }

  private absoluteUrl(url: string): string {
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    return new URL(url, this.BASE_URL).toString();
  }

  private extractSeriesId(url: string): string {
    return new URL(url, this.BASE_URL).searchParams.get("id") || "";
  }

  private extractChapterId(url: string): string {
    const parsed = new URL(url, this.BASE_URL);
    return (
      parsed.searchParams.get("id") ||
      parsed.searchParams.get("chapter") ||
      parsed.pathname.split("/").filter(Boolean).pop() ||
      ""
    );
  }

  private withPageCount(url: string, pageCount: number): string {
    const parsed = new URL(url, this.BASE_URL);
    parsed.searchParams.set("pages", String(pageCount));
    return parsed.toString();
  }

  private withoutPageCount(url: string): string {
    const parsed = new URL(url, this.BASE_URL);
    parsed.searchParams.delete("pages");
    return parsed.toString();
  }

  private extractChapterNumberFromText(text: string): number {
    const match = text.match(/(?:cap[ií]tulo|cap|chapter|ch)[^\d]*(\d+(?:\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
  }

  private normalizeTitle(title: string): string {
    return title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private slugify(title: string): string {
    return this.normalizeTitle(title).replace(/\s+/g, "-");
  }
}
