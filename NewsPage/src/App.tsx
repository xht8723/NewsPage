import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  Cpu,
  LayoutGrid,
  Square, 
  List
} from 'lucide-react';

interface newsItemType {
  id: number,
  category: string,
  title: string,
  summary: string,
  content: string,
  source: string,
  timestamp: string
};

const App = () => {
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSummarize = async () => {
    setIsLoading(true);
    try {
      const summaryText = await invoke('summarize_url', { url });
      setSummary(summaryText as string);
    } catch (error) {
      console.error('Error summarizing url:', error);
      setSummary('Error summarizing URL. Please check the console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <div className="container">
        <h1>News Summarizer</h1>
        <div className="input-container">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter URL to summarize"
          />
          <button onClick={handleSummarize} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : 'Summarize'}
          </button>
        </div>
        <div className="summary-container">
          <h2>Summary</h2>
          <p>{summary}</p>
        </div>
      </div>
    </div>
  );
};

export default App;