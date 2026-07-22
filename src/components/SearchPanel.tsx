import { useState } from 'react';
import { Link2, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { getPlaylist, getVideo, searchVideos } from '../lib/api';
import { isProbablyUrl, parseYouTubeInput } from '../lib/youtube';
import type { VideoItem } from '../types';

interface Props {
  canAdd: boolean;
  onAdd: (videos: VideoItem[]) => Promise<void>;
}

export function SearchPanel({ canAdd, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VideoItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const value = query.trim();
    if (!value || busy) return;
    if (!canAdd) {
      setError('Bạn cần quyền DJ để thêm bài.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const parsed = parseYouTubeInput(value);
      if (parsed?.playlistId) {
        const videos = await getPlaylist(parsed.playlistId);
        await onAdd(videos);
        setQuery('');
        setResults([]);
      } else if (parsed?.videoId) {
        const video = await getVideo(parsed.videoId);
        await onAdd([video]);
        setQuery('');
        setResults([]);
      } else if (isProbablyUrl(value)) {
        throw new Error('Link YouTube không hợp lệ hoặc không được hỗ trợ.');
      } else {
        setResults(await searchVideos(value));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xử lý yêu cầu.');
    } finally {
      setBusy(false);
    }
  }

  async function addResult(video: VideoItem) {
    setBusy(true);
    try {
      await onAdd([video]);
      setResults((items) => items.filter((item) => item.id !== video.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="search-panel">
      <div className="search-box">
        {isProbablyUrl(query) ? <Link2 size={19} /> : <Search size={19} />}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
          placeholder="Dán link YouTube hoặc nhập từ khóa rồi Enter"
          aria-label="Tìm hoặc thêm video"
        />
        {query && !busy && <button className="icon-button" onClick={() => { setQuery(''); setResults([]); }}><X size={17} /></button>}
        <button className="search-submit" onClick={() => void submit()} disabled={busy || !query.trim()}>
          {busy ? <LoaderCircle className="spin" size={18} /> : 'Enter'}
        </button>
      </div>
      <p className="search-hint">Link sẽ được thêm ngay. Từ khóa chỉ bắt đầu tìm kiếm sau khi bạn nhấn Enter.</p>
      {error && <p className="form-error">{error}</p>}
      {results.length > 0 && (
        <div className="search-results">
          <div className="section-heading"><span>Kết quả tìm kiếm</span><button onClick={() => setResults([])}>Đóng</button></div>
          {results.map((video) => (
            <article className="search-result" key={video.id}>
              <img src={video.thumbnail} alt="" />
              <div><strong>{video.title}</strong><span>{video.channel}</span></div>
              <button className="add-result" onClick={() => void addResult(video)} disabled={busy}><Plus size={18} /> Thêm</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
