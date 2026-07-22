import { useEffect, useState } from 'react';
import { Gauge, Link2, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { getPlaylist, getSearchQuota, getVideo, searchVideos, type SearchQuota } from '../lib/api';
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
  const [quota, setQuota] = useState<SearchQuota | null>(null);

  useEffect(() => {
    void getSearchQuota().then(setQuota);
  }, []);

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
        setQuota(await getSearchQuota());
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
      <div className="search-panel-heading">
        <div>
          <span>THÊM VÀO PHÒNG</span>
          <strong>Tìm nhạc hoặc dán link YouTube</strong>
        </div>
        <div className="search-meta">
          {quota && <span className={`quota-pill ${quota.remaining <= 15 ? 'low' : ''}`} title="Số lượt ước tính do Worker ghi nhận"><Gauge size={13} /> ~{quota.remaining}/{quota.limit} lượt tìm</span>}
        </div>
      </div>
      <div className="search-box">
        {isProbablyUrl(query) ? <Link2 size={19} /> : <Search size={19} />}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
          placeholder="Tên bài hát, nghệ sĩ hoặc link YouTube..."
          aria-label="Tìm hoặc thêm video"
        />
        {query && !busy && <button className="icon-button" onClick={() => { setQuery(''); setResults([]); }}><X size={17} /></button>}
        <button className="search-submit" onClick={() => void submit()} disabled={busy || !query.trim()}>
          {busy ? <LoaderCircle className="spin" size={18} /> : 'Enter'}
        </button>
      </div>
      <p className="search-hint">Link được thêm trực tiếp · Từ khóa chỉ được tìm sau khi nhấn Enter</p>
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
