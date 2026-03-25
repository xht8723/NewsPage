import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  LayoutGrid,
  LayoutList,
  CreditCard,
  Calendar,
  ArrowLeft,
  Moon,
  Sun,
  Newspaper,
  ChevronRight,
  Search,
  RefreshCw,
  X,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import "./App.css";

const TOPIC_CATEGORIES = [
  "World",
  "Gaming",
  "Anime",
  "Technology",
  "Science",
  "Business",
  "Entertainment",
] as const;

const CATEGORIES = ["All", ...TOPIC_CATEGORIES] as const;

type Category = (typeof CATEGORIES)[number];
type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
type LayoutMode = "grid" | "card" | "list";

interface NewsArticle {
  id: string;
  category: TopicCategory;
  tags: string[];
  title: string;
  snippet: string;
  aiSummary: string;
  content: string;
  url: string;
  thumbnailUrl: string;
  date: string;
  timestamp: number;
}

interface BackendNewsItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source_name: string;
  source_icon: string;
  authors: string[];
  thumbnail: string;
  tags: string[];
  category: string;
  ai_summary: string;
  og_content: string;
  snippet: string;
}

interface UserSettings {
  newsLimit: number;
  scrapeCooldownHours: number;
  ollamaAddress: string;
  ollamaModel: string;
  serpApiKey: string;
}

type OllamaConnectionState = "unknown" | "ok" | "fail";

const DEFAULT_VISIBLE_CATEGORIES: Record<TopicCategory, boolean> = {
  World: true,
  Gaming: true,
  Anime: true,
  Technology: true,
  Science: true,
  Business: true,
  Entertainment: true,
};

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDateString(dateString: string, days: number): string {
  const nextDate = new Date(`${dateString}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + days);
  return formatDateLocal(nextDate);
}

function getUtcDateKey(dateValue: string): string {
  const parsed = Date.parse(dateValue);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return dateValue.slice(0, 10);
}

function toTopicCategory(value: string): TopicCategory {
  const normalized = value.trim().toLowerCase();
  const found = TOPIC_CATEGORIES.find((category) => category.toLowerCase() === normalized);
  return found ?? "World";
}

function resolveThumbnailSrc(thumbnail: string): string {
  const fallback = "https://placehold.co/640x360/27272a/a1a1aa?text=News";
  const value = thumbnail.trim();
  if (!value) {
    return fallback;
  }

  if (/^(asset|tauri|file):/i.test(value)) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const normalizedPath = value.replace(/\\/g, "/");
    return convertFileSrc(normalizedPath);
  } catch {
    return fallback;
  }
}

function mapBackendNewsItem(item: BackendNewsItem): NewsArticle {
  const parsedTimestamp = Date.parse(item.date);
  const normalizedTags = item.tags.length > 0 ? item.tags : [item.source_name || "Update"];
  return {
    id: item.id,
    category: toTopicCategory(item.category),
    tags: normalizedTags,
    title: item.title,
    snippet: item.snippet || "",
    aiSummary: item.ai_summary || "",
    content: item.og_content || item.ai_summary || item.snippet || "Content unavailable.",
    url: item.url || "",
    thumbnailUrl: resolveThumbnailSrc(item.thumbnail),
    date: getUtcDateKey(item.date),
    timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
  };
}

function App(): React.JSX.Element {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category>("All");
  const [layout, setLayout] = useState<LayoutMode>("card");
  const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [visibleCategories, setVisibleCategories] = useState<Record<TopicCategory, boolean>>(DEFAULT_VISIBLE_CATEGORIES);
  const refreshTimeoutRef = useRef<number | null>(null);
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number; enriched: number } | null>(null);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const todayString = formatDateLocal(new Date());
  const canGoToNextDay = selectedDate < todayString;

  const [settings, setSettings] = useState<UserSettings>({
    newsLimit: 5,
    scrapeCooldownHours: 2,
    ollamaAddress: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    serpApiKey: "",
  });
  const [ollamaConnectionState, setOllamaConnectionState] = useState<OllamaConnectionState>("unknown");
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [purgeConfirmStep, setPurgeConfirmStep] = useState<0 | 1 | 2>(0);
  const [isPurging, setIsPurging] = useState(false);
  const [showLayoutSwitcher, setShowLayoutSwitcher] = useState(true);
  const settingsSaveTimeoutRef = useRef<number | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    invoke<Record<string, string>>("load_settings")
      .then((saved) => {
        setSettings((prev) => ({
          ...prev,
          newsLimit: saved.newsLimit ? Math.min(50, Math.max(1, Number(saved.newsLimit))) : prev.newsLimit,
          scrapeCooldownHours: saved.scrapeCooldownHours ? Math.min(24, Math.max(0, Number(saved.scrapeCooldownHours))) : prev.scrapeCooldownHours,
          ollamaAddress: saved.ollamaAddress?.trim() ? saved.ollamaAddress : prev.ollamaAddress,
          ollamaModel: saved.ollamaModel?.trim() ? saved.ollamaModel : prev.ollamaModel,
          serpApiKey: saved.serpApiKey ?? prev.serpApiKey,
        }));
        if (saved.selectedCategory && (CATEGORIES as readonly string[]).includes(saved.selectedCategory)) {
          setSelectedCategory(saved.selectedCategory as Category);
        }

        if (saved.visibleCategories) {
          try {
            const parsed = JSON.parse(saved.visibleCategories) as Partial<Record<TopicCategory, boolean>>;
            const next: Record<TopicCategory, boolean> = { ...DEFAULT_VISIBLE_CATEGORIES };
            for (const category of TOPIC_CATEGORIES) {
              if (typeof parsed[category] === "boolean") {
                next[category] = parsed[category] as boolean;
              }
            }

            const hasAnyVisible = TOPIC_CATEGORIES.some((category) => next[category]);
            setVisibleCategories(hasAnyVisible ? next : DEFAULT_VISIBLE_CATEGORIES);
          } catch {
            // Ignore invalid stored visibility JSON.
          }
        }
      })
      .catch(() => { /* first launch — no settings file yet */ });
  }, []);

  // Persist a single setting key with debounce for text inputs
  const saveSetting = useCallback((key: string, value: string) => {
    if (settingsSaveTimeoutRef.current !== null) {
      window.clearTimeout(settingsSaveTimeoutRef.current);
    }
    settingsSaveTimeoutRef.current = window.setTimeout(() => {
      void invoke("save_setting", { key, value });
    }, 500);
  }, []);

  const testOllamaConnection = useCallback(async (address: string) => {
    setIsTestingOllama(true);
    try {
      await invoke<boolean>("test_ollama_connection", { address });
      setOllamaConnectionState("ok");
    } catch {
      setOllamaConnectionState("fail");
    } finally {
      setIsTestingOllama(false);
    }
  }, []);

  const refreshOllamaModels = useCallback(async (address: string, preferredModel?: string) => {
    setIsRefreshingModels(true);
    try {
      const models = await invoke<string[]>("list_ollama_models", { address });
      setOllamaModels(models);
      setOllamaConnectionState("ok");
      if (models.length === 0) {
        return;
      }

      const candidate = preferredModel ?? models[0];
      const nextModel = models.includes(candidate) ? candidate : models[0];
      setSettings((s) => {
        if (s.ollamaModel === nextModel) {
          return s;
        }
        saveSetting("ollamaModel", nextModel);
        return { ...s, ollamaModel: nextModel };
      });
    } catch {
      setOllamaConnectionState("fail");
      setOllamaModels([]);
    } finally {
      setIsRefreshingModels(false);
    }
  }, [saveSetting]);

  const fetchEnrichedNews = useCallback(async (filterByDate: boolean = true, preserveOnEmpty: boolean = false) => {
    const categoryArg = selectedCategory === "All" ? null : selectedCategory.toLowerCase();
    const rows = await invoke<BackendNewsItem[]>("get_enriched_news", {
      category: categoryArg,
      date: filterByDate ? selectedDate : null,
      limit: 500,
      offset: 0,
    });

    const mapped = rows.map(mapBackendNewsItem);
    setNews((prev) => {
      if ((preserveOnEmpty || loading) && mapped.length === 0 && prev.length > 0) {
        return prev;
      }
      return mapped;
    });
  }, [selectedCategory, selectedDate, loading]);

  const scheduleRefresh = useCallback((filterByDate: boolean) => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      // During incremental enrichment updates, avoid flashing the list empty on transient empty responses.
      void fetchEnrichedNews(filterByDate, true);
    }, 300);
  }, [fetchEnrichedNews]);

  const generateNews = async () => {
    setLoading(true);
    setEnrichmentProgress({ current: 0, total: 0, enriched: 0 });
    setEnrichmentError(null);
    console.log("🚀 Starting enrichment pipeline...");
    invoke("start_all_action", {
      limit: settings.newsLimit,
      cooldownHours: settings.scrapeCooldownHours,
      ollamaAddress: settings.ollamaAddress,
      ollamaModel: settings.ollamaModel,
    })
      .then(() => {
        console.log("✅ Enrichment pipeline completed!");
      })
      .catch((error) => {
        console.error("❌ Enrichment pipeline failed:", error);
        setLoading(false);
      });
  };

  const availableCategories = useMemo(
    () => ["All", ...TOPIC_CATEGORIES.filter((category) => visibleCategories[category])] as Category[],
    [visibleCategories],
  );

  useEffect(() => {
    void fetchEnrichedNews();
  }, [fetchEnrichedNews]);

  useEffect(() => {
    let unlistenUpdated: (() => void) | null = null;
    let unlistenCompleted: (() => void) | null = null;

    const initListeners = async () => {
      try {
        unlistenUpdated = await listen<{current: number; total: number; enriched_count: number; date?: string}>("enriched-news-updated", (event) => {
          console.log("📬 enriched-news-updated event received:", event.payload);
          setEnrichmentProgress({
            current: event.payload.current,
            total: event.payload.total,
            enriched: event.payload.enriched_count,
          });
          const eventDate = event.payload.date ? getUtcDateKey(event.payload.date) : null;
          if (selectedDate === todayString || eventDate === selectedDate) {
            scheduleRefresh(true);
          }
        });
        console.log("✅ Listener registered: enriched-news-updated");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-updated listener:", error);
      }

      try {
        unlistenCompleted = await listen<{total: number; enriched_count: number; failed_count: number; error_sample?: string}>("enriched-news-sync-complete", (event) => {
          console.log("📬 enriched-news-sync-complete event received:", event.payload);
          setEnrichmentProgress(null);
          setLoading(false);
          if (event.payload.error_sample && event.payload.enriched_count === 0 && event.payload.failed_count > 0) {
            setEnrichmentError(event.payload.error_sample);
          } else {
            setEnrichmentError(null);
          }
          // Fetch with current date/category filter now that enrichment is done
          void fetchEnrichedNews(true, true);
        });
        console.log("✅ Listener registered: enriched-news-sync-complete");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-sync-complete listener:", error);
      }
    };

    void initListeners();

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (unlistenUpdated) {
        unlistenUpdated();
      }
      if (unlistenCompleted) {
        unlistenCompleted();
      }
    };
  }, [scheduleRefresh, fetchEnrichedNews, selectedDate, todayString]);

  useEffect(() => {
    if (selectedCategory !== "All" && !visibleCategories[selectedCategory] && availableCategories.length > 0) {
      setSelectedCategory(availableCategories[0]);
    }
  }, [availableCategories, selectedCategory, visibleCategories]);

  useEffect(() => {
    if (!showSettings) {
      return;
    }

    const address = settings.ollamaAddress;
    const model = settings.ollamaModel;
    void testOllamaConnection(address);
    void refreshOllamaModels(address, model);
  }, [showSettings, testOllamaConnection, refreshOllamaModels]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const updateByPointerType = () => {
      setShowLayoutSwitcher(coarsePointerQuery.matches);
    };

    updateByPointerType();

    const handleMouseMove = (event: MouseEvent) => {
      if (coarsePointerQuery.matches) {
        return;
      }

      const nearBottom = window.innerHeight - event.clientY <= 140;
      setShowLayoutSwitcher((current) => (current === nearBottom ? current : nearBottom));
    };

    const handleMouseLeaveWindow = (event: MouseEvent) => {
      if (!coarsePointerQuery.matches && event.relatedTarget === null) {
        setShowLayoutSwitcher(false);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseLeaveWindow);
    coarsePointerQuery.addEventListener("change", updateByPointerType);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseLeaveWindow);
      coarsePointerQuery.removeEventListener("change", updateByPointerType);
    };
  }, []);

  const toggleCategoryVisibility = (category: TopicCategory) => {
    setVisibleCategories((current) => {
      const visibleCount = TOPIC_CATEGORIES.filter((item) => current[item]).length;
      if (current[category] && visibleCount === 1) {
        return current;
      }

      const next = {
        ...current,
        [category]: !current[category],
      };
      saveSetting("visibleCategories", JSON.stringify(next));
      return next;
    });
  };

  const filteredNews = useMemo(() => {
    const sortedNews = [...news].sort((left, right) => {
      if (left.date === right.date) {
        return right.timestamp - left.timestamp;
      }
      return right.date.localeCompare(left.date);
    });

    const dateFiltered = sortedNews.filter((item) => item.date === selectedDate);

    if (selectedCategory === "All") {
      return dateFiltered.filter((item) => visibleCategories[item.category]);
    }

    return dateFiltered.filter((item) => item.category === selectedCategory);
  }, [news, selectedCategory, selectedDate, visibleCategories]);

  const getTagColor = (category: NewsArticle["category"]) => {
    const colors: Record<NewsArticle["category"], string> = {
      World: "bg-sky-500/90",
      Gaming: "bg-violet-500/90",
      Anime: "bg-pink-500/90",
      Technology: "bg-indigo-500/90",
      Science: "bg-amber-500/90",
      Business: "bg-emerald-500/90",
      Entertainment: "bg-fuchsia-500/90",
    };
    return colors[category] || "bg-zinc-500";
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? "bg-zinc-950 text-zinc-400" : "bg-zinc-100 text-zinc-800"}`}>
      <aside className={`fixed left-0 top-0 z-20 hidden h-full w-64 flex-col border-r transition-colors md:flex ${isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-zinc-50 border-zinc-200"}`}>
        <div className="flex items-center gap-3 border-b border-inherit p-6">
          <div className={`${isDarkMode ? "bg-zinc-100 text-black" : "bg-zinc-800 text-white"} rounded-lg p-2 shadow-sm`}>
            <Newspaper size={24} />
          </div>
          <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>NewsPage</h1>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Categories</p>
            <button
              onClick={() => setShowCategoryManager((current) => !current)}
              className={`inline-flex items-center rounded-full border p-1.5 transition-colors ${
                isDarkMode ? "border-zinc-800 text-zinc-400 hover:bg-zinc-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-200"
              }`}
              aria-label="Manage visible categories"
            >
              <SlidersHorizontal size={12} />
            </button>
          </div>

          {showCategoryManager && (
            <div className={`mb-4 space-y-2 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-white"}`}>
              {TOPIC_CATEGORIES.map((category) => {
                const visibleCount = TOPIC_CATEGORIES.filter((item) => visibleCategories[item]).length;
                const isLastVisible = visibleCategories[category] && visibleCount === 1;

                return (
                  <button
                    key={`${category}-visibility`}
                    onClick={() => toggleCategoryVisibility(category)}
                    disabled={isLastVisible}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                      visibleCategories[category]
                        ? isDarkMode
                          ? "bg-zinc-800 text-zinc-100"
                          : "bg-zinc-100 text-zinc-900"
                        : isDarkMode
                          ? "bg-zinc-900 text-zinc-500"
                          : "bg-zinc-50 text-zinc-500"
                    } ${isLastVisible ? "cursor-not-allowed opacity-50" : "hover:opacity-90"}`}
                  >
                    <span>{category}</span>
                    <span className="text-[10px] uppercase tracking-widest">{visibleCategories[category] ? "Shown" : "Hidden"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {availableCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat);
                void invoke("save_setting", { key: "selectedCategory", value: cat });
              }}
              className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-all ${
                selectedCategory === cat
                  ? isDarkMode
                    ? "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700"
                    : "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300"
                  : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-300"
              }`}
            >
              <span>{cat}</span>
              {selectedCategory === cat && <ChevronRight size={14} />}
            </button>
          ))}

          {availableCategories.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-500">
              Select at least one topic to keep the feed visible.
            </div>
          )}
        </nav>

        <div className="space-y-4 border-t border-inherit p-4">
          <button
            onClick={() => setShowCalendar(true)}
            className={`w-full rounded-xl border px-3 py-3 transition-all ${
              isDarkMode
                ? "border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:bg-zinc-800"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-200"
            } flex items-center gap-3`}
          >
            <Calendar size={18} />
            <div className="text-left">
              <p className="text-[10px] font-bold uppercase tracking-tighter opacity-60">Browse Date</p>
              <p className="text-xs font-bold">{selectedDate}</p>
            </div>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSelectedDate((currentDate) => offsetDateString(currentDate, -1))}
              className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                isDarkMode
                  ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Yesterday
            </button>
            {canGoToNextDay && (
              <button
                onClick={() => setSelectedDate((currentDate) => offsetDateString(currentDate, 1))}
                className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                  isDarkMode
                    ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                Next day
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex h-screen flex-col overflow-hidden p-4 pb-24 md:ml-64 md:p-8">
        <header
          className={`mb-6 flex shrink-0 flex-col justify-between gap-4 border-b pb-4 md:flex-row md:items-center ${
            isDarkMode ? "border-zinc-800" : "border-zinc-200"
          }`}
        >
          <div>
            <h2 className={`text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{selectedCategory} News</h2>
            <p className="text-sm font-medium text-zinc-500">
              {enrichmentError ? (
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold shadow-sm ${
                    isDarkMode
                      ? "border-red-500/40 bg-red-500/15 text-red-300"
                      : "border-red-400 bg-red-50 text-red-800"
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                  Ollama error — {enrichmentError}
                </span>
              ) : enrichmentProgress ? (
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold shadow-sm ${
                    isDarkMode
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-emerald-400 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  Enriching: {enrichmentProgress.current}/{enrichmentProgress.total} items ({enrichmentProgress.enriched} completed)
                </span>
              ) : (
                selectedCategory === "All" ? `All briefings for ${selectedDate}` : `Session briefing for ${selectedDate}`
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              <Settings size={18} />
            </button>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={generateNews}
              disabled={loading}
              className={`ml-2 flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-widest shadow-md transition-all ${
                isDarkMode ? "bg-zinc-200 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-white hover:bg-zinc-900"
              } disabled:opacity-50`}
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <Newspaper size={16} />}
              Generate
            </button>
          </div>
        </header>

        <section className={`news-scroll min-h-0 flex-1 overflow-y-auto pb-24 pr-1 ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          {filteredNews.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
              <Search size={48} className="text-zinc-500" />
              <div>
                <h3 className="text-lg font-bold">No briefings for this date</h3>
                <p className="text-sm">Click Generate to run the backend pipeline and populate enriched news for {selectedDate}.</p>
              </div>
            </div>
          ) : (
            <div
              className={`
                ${layout === "grid" ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" : ""}
                ${layout === "card" ? "grid grid-cols-1 gap-6 md:grid-cols-2" : ""}
                ${layout === "list" ? "flex flex-col gap-4" : ""}
              `}
            >
              {filteredNews.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedArticle(item)}
                  className={`group cursor-pointer rounded-2xl border transition-all hover:shadow-lg ${
                    isDarkMode ? "border-zinc-800 bg-zinc-900 hover:border-zinc-600" : "border-zinc-200 bg-white hover:border-zinc-300"
                  } ${layout === "list" ? "flex flex-col gap-4 p-4 md:flex-row" : "flex flex-col"}`}
                >
                  <div
                    className={`${
                      layout === "list" ? "h-44 w-full md:h-auto md:w-56 md:flex-shrink-0" : "h-44 w-full"
                    } overflow-hidden rounded-xl`}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={`${item.title} thumbnail`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = "https://placehold.co/640x360/27272a/a1a1aa?text=News";
                      }}
                    />
                  </div>
                  <div className={`p-6 ${layout === "list" ? "md:py-2" : ""} flex flex-1 flex-col`}>
                    <div className="mb-4 flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm ${getTagColor(item.category)}`}>
                        {item.category}
                      </span>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      {item.tags.map((tag, tagIndex) => (
                        <span key={`${item.id}-tag-${tagIndex}`} className="rounded bg-zinc-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h3
                      className={`text-lg mb-3 font-bold leading-tight transition-colors ${
                        isDarkMode ? "text-zinc-100 group-hover:text-white" : "text-zinc-900"
                      }`}
                    >
                      {item.title}
                    </h3>
                    <p className={`mb-5 text-sm leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>{item.snippet}</p>
                    <div
                      className={`mt-auto flex items-center text-[10px] font-black uppercase tracking-widest opacity-60 transition-opacity group-hover:opacity-100 ${
                        isDarkMode ? "text-zinc-400" : "text-zinc-900"
                      }`}
                    >
                      Open Brief <ChevronRight size={12} className="ml-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div
          className={`fixed bottom-8 left-1/2 z-30 -translate-x-1/2 transition-all duration-200 md:left-[calc(50%+128px)] ${
            showLayoutSwitcher ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"
          }`}
        >
          <div
            className={`flex items-center gap-1 rounded-full border p-1 shadow-xl backdrop-blur-lg ${
              isDarkMode ? "border-zinc-700 bg-zinc-900/80 text-zinc-400" : "border-zinc-300 bg-white/80 text-zinc-600"
            }`}
          >
            <button
              onClick={() => setLayout("grid")}
              className={`rounded-full p-2.5 transition-all ${
                layout === "grid"
                  ? isDarkMode
                    ? "bg-zinc-100 text-black shadow-md"
                    : "bg-zinc-800 text-white shadow-md"
                  : "hover:bg-zinc-500/10"
              }`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setLayout("card")}
              className={`rounded-full p-2.5 transition-all ${
                layout === "card"
                  ? isDarkMode
                    ? "bg-zinc-100 text-black shadow-md"
                    : "bg-zinc-800 text-white shadow-md"
                  : "hover:bg-zinc-500/10"
              }`}
            >
              <CreditCard size={16} />
            </button>
            <button
              onClick={() => setLayout("list")}
              className={`rounded-full p-2.5 transition-all ${
                layout === "list"
                  ? isDarkMode
                    ? "bg-zinc-100 text-black shadow-md"
                    : "bg-zinc-800 text-white shadow-md"
                  : "hover:bg-zinc-500/10"
              }`}
            >
              <LayoutList size={16} />
            </button>
          </div>
        </div>
      </main>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowSettings(false); setPurgeConfirmStep(0); }} />
          <div
            className={`relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl ${
              isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-white text-zinc-800"
            }`}
          >
            <div
              className={`flex items-center justify-between border-b p-6 ${
                isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-100 bg-zinc-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-zinc-500" />
                <h3 className="text-base font-bold uppercase tracking-widest">Preferences</h3>
              </div>
              <button onClick={() => { setShowSettings(false); setPurgeConfirmStep(0); }} className="hover:opacity-50">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[calc(100vh-10rem)] space-y-6 overflow-y-auto p-6">
              {/* General */}
              <div>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>General</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">Number of news pulled</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.newsLimit}
                      onChange={(e) => {
                        const val = Math.min(50, Math.max(1, Number(e.target.value)));
                        setSettings((s) => ({ ...s, newsLimit: val }));
                        saveSetting("newsLimit", String(val));
                      }}
                      className={`w-20 rounded-lg border px-3 py-1.5 text-center text-sm font-semibold focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-100 text-zinc-900"
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-medium">Scrape cooldown (hours)</span>
                      <p className="mt-0.5 text-xs opacity-50">Min time between website scrapes. 0 = always scrape.</p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={settings.scrapeCooldownHours}
                      onChange={(e) => {
                        const val = Math.min(24, Math.max(0, Number(e.target.value)));
                        setSettings((s) => ({ ...s, scrapeCooldownHours: val }));
                        saveSetting("scrapeCooldownHours", String(val));
                      }}
                      className={`w-20 shrink-0 rounded-lg border px-3 py-1.5 text-center text-sm font-semibold focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-100 text-zinc-900"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* API Settings */}
              <div>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>API Settings</p>
                <div className="space-y-3">
                  <div className={`rounded-xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-50"}`}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <label className="text-xs font-medium opacity-70">Ollama Connection Address</label>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            ollamaConnectionState === "ok"
                              ? "bg-emerald-500"
                              : ollamaConnectionState === "fail"
                                ? "bg-red-500"
                                : "bg-zinc-500"
                          }`}
                          title={ollamaConnectionState === "ok" ? "Connected" : ollamaConnectionState === "fail" ? "Connection failed" : "Not tested"}
                        />
                        <button
                          type="button"
                          onClick={() => void testOllamaConnection(settings.ollamaAddress)}
                          disabled={isTestingOllama}
                          className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                            isDarkMode
                              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                          } disabled:opacity-50`}
                        >
                          {isTestingOllama ? "Testing..." : "Test Connection"}
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="http://127.0.0.1:11434"
                      value={settings.ollamaAddress}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettings((s) => ({ ...s, ollamaAddress: val }));
                        setOllamaConnectionState("unknown");
                        saveSetting("ollamaAddress", val);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                          : "border-zinc-300 bg-zinc-100 text-zinc-900 placeholder-zinc-400"
                      }`}
                    />
                  </div>

                  <div className={`rounded-xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-50"}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="text-xs font-medium opacity-70">Ollama Model</label>
                      <button
                        type="button"
                        onClick={() => void refreshOllamaModels(settings.ollamaAddress)}
                        disabled={isRefreshingModels}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                          isDarkMode
                            ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                        } disabled:opacity-50`}
                      >
                        <RefreshCw size={12} className={isRefreshingModels ? "animate-spin" : ""} />
                        Refresh
                      </button>
                    </div>
                    <select
                      value={settings.ollamaModel}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettings((s) => ({ ...s, ollamaModel: val }));
                        saveSetting("ollamaModel", val);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-100 text-zinc-900"
                      }`}
                    >
                      {ollamaModels.length === 0 ? (
                        <option value={settings.ollamaModel}>{settings.ollamaModel || "No models found"}</option>
                      ) : (
                        ollamaModels.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium opacity-70">SerpAPI Key</label>
                    <input
                      type="password"
                      placeholder="Enter your SerpAPI key…"
                      value={settings.serpApiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettings((s) => ({ ...s, serpApiKey: val }));
                        saveSetting("serpApiKey", val);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                          : "border-zinc-300 bg-zinc-100 text-zinc-900 placeholder-zinc-400"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-red-500">Danger Zone</p>
                <div className={`rounded-xl border border-red-500/30 p-4 ${isDarkMode ? "bg-red-950/20" : "bg-red-50"}`}>
                  <p className="mb-1 text-sm font-semibold">Purge Database</p>
                  <p className={`mb-4 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                    Permanently deletes all news articles and cached thumbnails. This cannot be undone.
                  </p>

                  {purgeConfirmStep === 0 && (
                    <button
                      type="button"
                      onClick={() => setPurgeConfirmStep(1)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
                    >
                      Purge Database
                    </button>
                  )}

                  {purgeConfirmStep === 1 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-red-500">Are you sure? All data will be lost.</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPurgeConfirmStep(2)}
                          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
                        >
                          Yes, continue
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurgeConfirmStep(0)}
                          className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                            isDarkMode
                              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                          }`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {purgeConfirmStep === 2 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-red-500">Final confirmation — this will delete everything permanently.</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isPurging}
                          onClick={async () => {
                            setIsPurging(true);
                            try {
                              await invoke("purge_database");
                              setNews([]);
                            } catch (err) {
                              console.error("Purge failed:", err);
                            } finally {
                              setIsPurging(false);
                              setPurgeConfirmStep(0);
                              setShowSettings(false);
                            }
                          }}
                          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {isPurging ? "Purging..." : "Yes, delete everything"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurgeConfirmStep(0)}
                          disabled={isPurging}
                          className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                            isDarkMode
                              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                          } disabled:opacity-50`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedArticle && (
        <div className={`fixed inset-0 z-50 overflow-y-auto ${isDarkMode ? "bg-zinc-950 text-zinc-300" : "bg-zinc-100 text-zinc-800"}`}>
          <div
            className={`sticky top-0 z-10 flex items-center border-b px-4 py-4 md:px-8 ${
              isDarkMode ? "border-zinc-800 bg-zinc-950/95" : "border-zinc-200 bg-zinc-100/95"
            } backdrop-blur-md`}
          >
            <button
              onClick={() => setSelectedArticle(null)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors ${
                isDarkMode ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-zinc-300 text-zinc-800 hover:bg-white"
              }`}
            >
              <ArrowLeft size={14} />
              Return
            </button>
          </div>

          <article className="pb-16">
            <div className="h-64 w-full md:h-[30rem]">
              <img
                src={selectedArticle.thumbnailUrl}
                alt={`${selectedArticle.title} thumbnail`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "https://placehold.co/1200x640/27272a/a1a1aa?text=News";
                }}
              />
            </div>

            <div className="mx-auto w-full max-w-5xl space-y-8 px-4 pt-8 md:px-8">
              <div>
                <span
                  className={`mb-4 inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm ${getTagColor(
                    selectedArticle.category,
                  )}`}
                >
                  {selectedArticle.category}
                </span>
                <h2 className={`text-3xl font-black leading-tight md:text-5xl ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>
                  {selectedArticle.title}
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedArticle.tags.map((tag, tagIndex) => (
                    <span key={`${selectedArticle.id}-detail-tag-${tagIndex}`} className="rounded-full bg-zinc-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-70">
                      {tag}
                    </span>
                  ))}
                  <span className="rounded-full bg-zinc-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-70">{selectedArticle.date}</span>
                </div>
              </div>

              <div className={`rounded-2xl border-l-4 p-6 ${isDarkMode ? "border-zinc-400 bg-zinc-900" : "border-zinc-800 bg-white"}`}>
                <ReactMarkdown
                  components={{
                    ul: ({ children }) => (
                      <ul className={`space-y-2 text-lg leading-relaxed ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{children}</ul>
                    ),
                    li: ({ children }) => (
                      <li className="flex gap-2">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${isDarkMode ? "bg-zinc-400" : "bg-zinc-600"}`} />
                        <span>{children}</span>
                      </li>
                    ),
                    p: ({ children }) => (
                      <p className={`text-lg leading-relaxed ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{children}</p>
                    ),
                  }}
                >
                  {selectedArticle.aiSummary}
                </ReactMarkdown>
              </div>

              <div className={`space-y-6 text-lg leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-700"}`}>
                {selectedArticle.url && (
                  <button
                    onClick={() => invoke("open_url", { url: selectedArticle.url })}
                    className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
                      isDarkMode
                        ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                        : "bg-zinc-200 text-zinc-900 hover:bg-zinc-300"
                    }`}
                  >
                    Open Original Article
                  </button>
                )}
              </div>
            </div>
          </article>
        </div>
      )}

      {showCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCalendar(false)} />
          <div
            className={`relative w-full max-w-sm rounded-3xl border p-8 shadow-2xl ${
              isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"
            }`}
          >
            <h3 className="mb-6 text-sm font-black uppercase tracking-widest opacity-60">Jump to Date</h3>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setShowCalendar(false);
              }}
              className={`w-full rounded-xl border p-4 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-zinc-500 ${
                isDarkMode ? "border-zinc-700 bg-zinc-800 text-white" : "border-zinc-200 bg-zinc-50 text-black"
              }`}
            />
            <button
              onClick={() => setShowCalendar(false)}
              className={`mt-6 w-full rounded-xl py-4 text-xs font-black uppercase tracking-widest transition-all ${
                isDarkMode ? "bg-zinc-200 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-white hover:bg-zinc-900"
              }`}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;