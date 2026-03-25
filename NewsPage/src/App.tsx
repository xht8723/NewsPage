import React, { useMemo, useState } from "react";
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
} from "lucide-react";
import "./App.css";

const CATEGORIES = [
  "All",
  "Technology",
  "Business",
  "Politics",
  "Science",
  "Health",
  "Sports",
  "Entertainment",
] as const;

type Category = (typeof CATEGORIES)[number];
type LayoutMode = "grid" | "card" | "list";

interface NewsArticle {
  id: string;
  category: Exclude<Category, "All">;
  tag: string;
  title: string;
  summary: string;
  content: string;
  thumbnailUrl: string;
  date: string;
  timestamp: number;
}

interface UserSettings {
  aiEnhanced: boolean;
  compactView: boolean;
  notifications: boolean;
  language: string;
}

const SAMPLE_TITLES: Record<Exclude<Category, "All">, string[]> = {
  Technology: ["Open-source assistant reaches new speed milestone", "Battery breakthrough cuts charge time for EV fleets"],
  Business: ["Regional retailers post stronger-than-expected quarter", "Logistics startup expands same-day delivery network"],
  Politics: ["Parliament debates new transparency package", "City leaders announce cross-border climate partnership"],
  Science: ["Astronomers identify unusual signal from nearby system", "Researchers map coral recovery after reef restoration"],
  Health: ["Hospital network pilots AI-supported triage process", "Public health campaign improves early screening uptake"],
  Sports: ["Underdog team clinches playoff spot in final minutes", "National federation unveils youth coaching initiative"],
  Entertainment: ["Festival lineup blends indie cinema and live scoring", "Streaming platform greenlights ambitious historical series"],
};

const SAMPLE_TAGS = [
  "Breaking",
  "Analysis",
  "Field Report",
  "Policy",
  "Trends",
  "Deep Dive",
  "Watchlist",
];

function createMockArticles(date: string): NewsArticle[] {
  const categories = CATEGORIES.filter((c): c is Exclude<Category, "All"> => c !== "All");
  return categories.map((category, index) => {
    const titleOptions = SAMPLE_TITLES[category];
    const title = titleOptions[index % titleOptions.length];
    const tag = SAMPLE_TAGS[(index + date.length) % SAMPLE_TAGS.length];
    const summary = `${category} briefing for ${date}: ${title}. Early indicators show broad impact across local and global stakeholders.`;
    const content = [
      `${title} is shaping today's agenda in ${category.toLowerCase()} circles, with experts flagging momentum around execution and measurable outcomes.`,
      "Observers describe the latest updates as practical rather than symbolic, with near-term actions expected over the next cycle.",
      "Analysts will monitor follow-up announcements to confirm whether the current pace translates into durable results.",
    ].join("\n");

    return {
      id: `${date}-${category}-${index}`,
      category,
      tag,
      title,
      summary,
      content,
      thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(`${date}-${category}-${index}`)}/640/360`,
      date,
      timestamp: Date.now() + index,
    };
  });
}

function App(): React.JSX.Element {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category>("All");
  const [layout, setLayout] = useState<LayoutMode>("card");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);

  const [settings, setSettings] = useState<UserSettings>({
    aiEnhanced: true,
    compactView: false,
    notifications: true,
    language: "English",
  });

  const generateNews = async () => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const generatedArticles = createMockArticles(selectedDate);
    setNews((prev) => [...generatedArticles, ...prev.filter((item) => item.date !== selectedDate)]);
    setLoading(false);
  };

  const filteredNews = useMemo(() => {
    const dateFiltered = news.filter((item) => item.date === selectedDate);
    if (selectedCategory === "All") {
      return dateFiltered;
    }
    return dateFiltered.filter((item) => item.category === selectedCategory);
  }, [news, selectedCategory, selectedDate]);

  const getTagColor = (category: NewsArticle["category"]) => {
    const colors: Record<NewsArticle["category"], string> = {
      Technology: "bg-indigo-500/90",
      Business: "bg-emerald-500/90",
      Politics: "bg-rose-500/90",
      Science: "bg-amber-500/90",
      Health: "bg-teal-500/90",
      Sports: "bg-orange-500/90",
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
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Categories</p>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
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
        </div>
      </aside>

      <main className="min-h-screen p-4 pb-24 md:ml-64 md:p-8">
        <header className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className={`text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{selectedCategory} News</h2>
            <p className="text-sm font-medium text-zinc-500">Session briefing for {selectedDate}</p>
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

        {filteredNews.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
            <Search size={48} className="text-zinc-500" />
            <div>
              <h3 className="text-lg font-bold">No briefings for this date</h3>
              <p className="text-sm">Click Generate to create local mock news for {selectedDate}.</p>
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
                    layout === "list" ? "h-44 w-full md:h-auto md:w-56 md:flex-shrink-0" : settings.compactView ? "h-36 w-full" : "h-44 w-full"
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
                <div className={`${settings.compactView ? "p-4" : "p-6"} ${layout === "list" ? "md:py-2" : ""} flex flex-1 flex-col`}>
                  <div className="mb-4 flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm ${getTagColor(item.category)}`}>
                      {item.category}
                    </span>
                    <span className="rounded bg-zinc-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{item.tag}</span>
                  </div>
                  <h3
                    className={`${settings.compactView ? "text-base" : "text-lg"} mb-3 font-bold leading-tight transition-colors ${
                      isDarkMode ? "text-zinc-100 group-hover:text-white" : "text-zinc-900"
                    }`}
                  >
                    {item.title}
                  </h3>
                  {!settings.compactView && (
                    <p className={`mb-5 text-sm leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>{item.summary}</p>
                  )}
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

        <div className="fixed bottom-8 left-1/2 z-30 -translate-x-1/2 md:left-[calc(50%+128px)]">
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
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
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
              <button onClick={() => setShowSettings(false)} className="hover:opacity-50">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-6 p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">AI Enhanced Mode</span>
                  <button
                    onClick={() => setSettings((s) => ({ ...s, aiEnhanced: !s.aiEnhanced }))}
                    className={`relative h-5 w-9 rounded-full transition-all ${
                      settings.aiEnhanced ? (isDarkMode ? "bg-zinc-200" : "bg-zinc-800") : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`absolute top-1 h-3 w-3 rounded-full transition-all ${
                        settings.aiEnhanced ? "right-1 bg-zinc-500" : "left-1 bg-zinc-400"
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Compact View</span>
                  <button
                    onClick={() => setSettings((s) => ({ ...s, compactView: !s.compactView }))}
                    className={`relative h-5 w-9 rounded-full transition-all ${
                      settings.compactView ? (isDarkMode ? "bg-zinc-200" : "bg-zinc-800") : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`absolute top-1 h-3 w-3 rounded-full transition-all ${
                        settings.compactView ? "right-1 bg-zinc-500" : "left-1 bg-zinc-400"
                      }`}
                    />
                  </button>
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
                  <span className="rounded-full bg-zinc-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-70">{selectedArticle.tag}</span>
                  <span className="rounded-full bg-zinc-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-70">{selectedArticle.date}</span>
                </div>
              </div>

              <div className={`rounded-2xl border-l-4 p-6 ${isDarkMode ? "border-zinc-400 bg-zinc-900" : "border-zinc-800 bg-white"}`}>
                <p className={`text-xl font-medium italic leading-relaxed ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>
                  "{selectedArticle.summary}"
                </p>
              </div>

              <div className={`space-y-6 text-lg leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-700"}`}>
                {selectedArticle.content.split("\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
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