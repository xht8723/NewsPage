import type React from "react";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { TOPIC_CATEGORIES } from "../constants/news";
import type { FeedDefinition } from "../types/news";

interface FeedManagerPanelProps {
  feeds: FeedDefinition[];
  isDarkMode: boolean;
  onCreateFeed: (name: string, categories: string[]) => Promise<void>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onDeleteFeed: (feedId: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  onSetFeedCategories: (feedId: string, categories: string[]) => Promise<void>;
  onReorderFeed: (feedId: string, direction: "up" | "down") => Promise<void>;
}

export function FeedManagerPanel({
  feeds,
  isDarkMode,
  onCreateFeed,
  onRenameFeed,
  onDeleteFeed,
  onToggleFeedVisibility,
  onSetFeedCategories,
  onReorderFeed,
}: FeedManagerPanelProps): React.JSX.Element {
  const [draftName, setDraftName] = useState("");
  const [draftCategories, setDraftCategories] = useState<string[]>(["world"]);
  const [renamingFeedId, setRenamingFeedId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const orderedFeeds = useMemo(
    () => [...feeds].sort((left, right) => left.sort_order - right.sort_order),
    [feeds],
  );

  const toggleDraftCategory = (category: string) => {
    setDraftCategories((current) => {
      if (current.includes(category)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== category);
      }
      return [...current, category];
    });
  };

  return (
    <div className={`mb-4 space-y-3 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-zinc-150"}`}>
      <div className="space-y-2 rounded-xl border border-zinc-700/40 p-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Create Feed</p>
        <input
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Feed name"
          className={`w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500"
              : "border-zinc-300 bg-zinc-100 text-zinc-900 placeholder-zinc-500"
          }`}
        />
        <div className="flex flex-wrap gap-1">
          {TOPIC_CATEGORIES.map((category) => {
            const key = category.toLowerCase();
            const active = draftCategories.includes(key);
            return (
              <button
                key={`draft-${category}`}
                type="button"
                onClick={() => toggleDraftCategory(key)}
                className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  active
                    ? isDarkMode
                      ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-200"
                      : "border-cyan-500 bg-cyan-100 text-cyan-700"
                    : isDarkMode
                      ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                      : "border-zinc-300 bg-zinc-100 text-zinc-600"
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={async () => {
            await onCreateFeed(draftName, draftCategories);
            setDraftName("");
            setDraftCategories(["world"]);
          }}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
          }`}
        >
          <Plus size={12} /> Add Feed
        </button>
      </div>

      <div className="space-y-2">
        {orderedFeeds.map((feed, index) => {
          const normalizedCategories = feed.categories.map((item) => item.toLowerCase());
          return (
            <div key={feed.id} className={`rounded-xl border p-2 ${isDarkMode ? "border-zinc-800 bg-zinc-900/70" : "border-zinc-200 bg-zinc-50"}`}>
              <div className="mb-2 flex items-center gap-1">
                {renamingFeedId === feed.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={renamingValue}
                    onChange={(event) => setRenamingValue(event.target.value)}
                    onBlur={async () => {
                      await onRenameFeed(feed.id, renamingValue);
                      setRenamingFeedId(null);
                    }}
                    onKeyDown={async (event) => {
                      if (event.key === "Enter") {
                        await onRenameFeed(feed.id, renamingValue);
                        setRenamingFeedId(null);
                      }
                    }}
                    className={`flex-1 rounded border px-2 py-1 text-xs focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                        : "border-zinc-300 bg-zinc-100 text-zinc-900"
                    }`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingFeedId(feed.id);
                      setRenamingValue(feed.name);
                    }}
                    className="flex-1 truncate text-left text-xs font-bold"
                    title="Click to rename"
                  >
                    {feed.name}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void onReorderFeed(feed.id, "up")}
                  disabled={index === 0}
                  className="rounded border border-zinc-700/50 p-1 text-zinc-400 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onReorderFeed(feed.id, "down")}
                  disabled={index === orderedFeeds.length - 1}
                  className="rounded border border-zinc-700/50 p-1 text-zinc-400 disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onToggleFeedVisibility(feed.id, !feed.is_visible)}
                  disabled={feed.id === "feed-all" && feed.is_visible}
                  title={feed.is_visible ? "Hide feed" : "Show feed"}
                  aria-label={feed.is_visible ? `Hide ${feed.name}` : `Show ${feed.name}`}
                  className={`rounded border p-1 disabled:opacity-30 ${
                    feed.is_visible
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-zinc-700/50 text-zinc-500"
                  }`}
                >
                  {feed.is_visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteFeed(feed.id)}
                  disabled={feed.id === "feed-all"}
                  className="rounded border border-red-500/40 p-1 text-red-400 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                {TOPIC_CATEGORIES.map((category) => {
                  const key = category.toLowerCase();
                  const active = normalizedCategories.includes(key);
                  return (
                    <button
                      key={`${feed.id}-${category}`}
                      type="button"
                      onClick={async () => {
                        const next = active
                          ? normalizedCategories.filter((item) => item !== key)
                          : [...normalizedCategories, key];
                        if (next.length === 0) {
                          return;
                        }
                        await onSetFeedCategories(feed.id, next);
                      }}
                      className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        active
                          ? isDarkMode
                            ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-200"
                            : "border-cyan-500 bg-cyan-100 text-cyan-700"
                          : isDarkMode
                            ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                            : "border-zinc-300 bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
