import "./App.css";
import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Settings, 
  Newspaper, 
  Gamepad2, 
  Globe, 
  MapPin, 
  ExternalLink, 
  ChevronLeft,
  Loader2,
  RefreshCw,
  Cpu
} from 'lucide-react';

interface NewsItem {
  id: number;
  category: string;
  title: string;
  summary: string;
  content: string;
  source: string;
  timestamp: string;
}

/**
 * Modern News Aggregator UI with Ollama Integration
 * Features:
 * - Start/Stop control to manage local LLM resources
 * - Card/Grid view for summarized news
 * - Interest-based categorization
 * - Detailed view with original sources
 */

const App = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('Global');
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [llmStatus, setLlmStatus] = useState('Idle');

  const categories = [
    { id: 'Global', icon: <Globe size={18} />, label: 'Global News' },
    { id: 'Gaming', icon: <Gamepad2 size={18} />, label: 'Gaming' },
    { id: 'Local', icon: <MapPin size={18} />, label: 'Local' },
  ];

  // Mock data for initial preview - In a real app, this would come from an API
  const mockNews = [
    {
      id: 1,
      category: 'Global',
      title: 'Major Breakthrough in Fusion Energy Research',
      summary: 'Scientists achieve a net energy gain in a sustained reaction for the first time, marking a milestone for clean energy.',
      content: 'The Lawrence Livermore National Laboratory reported a significant milestone in nuclear fusion research. Using 192 laser beams, the team successfully initiated a reaction that produced more energy than it consumed. This result has been peer-reviewed and confirmed by external physical societies. The implications for the global energy grid are profound, though commercialization remains decades away.',
      source: 'https://example.com/fusion-news',
      timestamp: '2 hours ago'
    },
    {
      id: 2,
      category: 'Gaming',
      title: 'Next-Gen RPG Console Exclusive Announced',
      summary: 'A renowned studio unveils a massive open-world fantasy epic set for a late 2026 release with advanced physics.',
      content: 'During the latest industry showcase, "Aetheria: The Lost Kingdom" was revealed. Developed by the team behind legendary RPGs, the game promises a world four times the size of previous entries with no loading screens. It features a revolutionary "Elemental Narrative" system where player choices physically alter the game world’s geography. Pre-orders are expected to start this summer.',
      source: 'https://example.com/gaming-hub',
      timestamp: '5 hours ago'
    },
    {
      id: 3,
      category: 'Local',
      title: 'New Community Tech Hub Opens Downtown',
      summary: 'City council approves funding for a public space dedicated to STEM education and startup incubation.',
      content: 'The old central library building will be repurposed into the "Innovate Center." With a budget of $15 million, the facility will provide high-speed internet, 3D printing labs, and mentorship programs for local entrepreneurs. The mayor stated this is the first step in transforming the district into a regional tech corridor.',
      source: 'https://example.com/local-daily',
      timestamp: '1 day ago'
    }
  ];

  // Logic to simulate LLM processing and API fetching
  const startAggregation = async () => {
    setIsProcessing(true);
    setLoading(true);
    setLlmStatus('Fetching Sources...');
    
    // Simulate API Delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setLlmStatus('LLM Summarizing (Ollama)...');
    // Simulate Ollama Processing (e.g., Llama 3.2 1B or Phi-3)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setNewsData(mockNews);
    setLoading(false);
    setLlmStatus('Complete');
  };

  const filteredNews = newsData.filter(item => item.category === activeTab);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Newspaper size={24} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">PulseNews</h1>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-4">Interests</p>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveTab(cat.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === cat.id 
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
                : 'hover:bg-slate-800 text-slate-400'
              }`}
            >
              {cat.icon}
              <span className="font-medium">{cat.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white transition-colors">
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header/Control Bar */}
        <header className="h-20 bg-slate-950/50 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">{activeTab} Feed</h2>
            {isProcessing && (
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-slate-300 font-mono uppercase">{llmStatus}</span>
              </div>
            )}
          </div>

          <button
            onClick={startAggregation}
            disabled={loading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all transform active:scale-95 shadow-lg ${
              isProcessing 
              ? 'bg-slate-800 text-slate-400 border border-slate-700' 
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20'
            }`}
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
            {isProcessing ? 'Syncing...' : 'Start Aggregation'}
          </button>
        </header>

        {/* News Grid */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-950">
          {!isProcessing ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mb-6 border border-slate-800">
                <Cpu className="text-slate-600" size={40} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Ready to Process</h3>
              <p className="text-slate-400">Click the start button to fetch news and generate AI summaries using your local LLM.</p>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl h-64 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredNews.map((item) => (
                <article 
                  key={item.id}
                  onClick={() => setSelectedNews(item)}
                  className="group bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-6 cursor-pointer transition-all hover:shadow-2xl hover:shadow-blue-900/10 flex flex-col"
                >
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                      {item.category}
                    </span>
                    <span className="text-xs text-slate-500">{item.timestamp}</span>
                  </div>
                  <h3 className="text-lg font-bold mb-3 group-hover:text-blue-400 transition-colors leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-slate-400 text-sm line-clamp-3 mb-4 flex-1">
                    {item.summary}
                  </p>
                  <div className="flex items-center gap-1 text-xs font-semibold text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    Read More <ExternalLink size={12} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* Detailed Modal Overlay */}
        {selectedNews && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 md:p-8">
            <div 
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={() => setSelectedNews(null)}
            />
            <div className="relative bg-slate-900 border border-slate-800 w-full max-w-3xl max-h-full overflow-y-auto rounded-3xl shadow-2xl flex flex-col">
              <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md p-6 border-b border-slate-800 flex items-center justify-between">
                <button 
                  onClick={() => setSelectedNews(null)}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                >
                  <ChevronLeft size={20} />
                  <span>Back to Grid</span>
                </button>
                <a 
                  href={selectedNews.source} 
                  target="_blank" 
                  rel="noreferrer"
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-colors"
                >
                  Original Source <ExternalLink size={14} />
                </a>
              </div>
              
              <div className="p-8 md:p-12">
                <div className="flex items-center gap-3 mb-6">
                  <span className="px-3 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs font-bold uppercase">
                    {selectedNews.category}
                  </span>
                  <span className="text-slate-500 text-sm">{selectedNews.timestamp}</span>
                </div>
                
                <h2 className="text-3xl md:text-4xl font-black mb-8 leading-tight">
                  {selectedNews.title}
                </h2>
                
                <div className="bg-slate-800/50 border-l-4 border-blue-500 p-6 rounded-r-2xl mb-10">
                  <p className="italic text-slate-300">
                    "AI Summary: {selectedNews.summary}"
                  </p>
                </div>
                
                <div className="prose prose-invert max-w-none">
                  <p className="text-slate-300 text-lg leading-relaxed mb-6">
                    {selectedNews.content}
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    This detailed report was compiled by PulseNews using local edge computing to respect your privacy and reduce bandwidth. The underlying data is sourced via third-party Google News aggregators and processed through a fine-tuned small language model running locally on your hardware.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;