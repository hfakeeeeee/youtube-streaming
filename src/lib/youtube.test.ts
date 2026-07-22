import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseYouTubeInput } from './youtube';

describe('parseYouTubeInput', () => {
  it('parses a regular YouTube link and timestamp', () => {
    assert.deepEqual(parseYouTubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), {
      videoId: 'dQw4w9WgXcQ',
      startSeconds: 90,
    });
  });

  it('parses Shorts and short links', () => {
    assert.equal(parseYouTubeInput('https://youtube.com/shorts/dQw4w9WgXcQ')?.videoId, 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeInput('youtu.be/dQw4w9WgXcQ')?.videoId, 'dQw4w9WgXcQ');
  });

  it('parses playlists', () => {
    assert.equal(parseYouTubeInput('https://youtube.com/playlist?list=PL1234567890abc')?.playlistId, 'PL1234567890abc');
  });

  it('rejects non-YouTube URLs', () => {
    assert.equal(parseYouTubeInput('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  });
});
