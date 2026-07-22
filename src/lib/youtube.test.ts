import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isYouTubeMixPlaylist, parseYouTubeInput } from './youtube';

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

  it('identifies dynamic YouTube Mix playlists', () => {
    assert.equal(isYouTubeMixPlaylist('RDMMabcdefghijk'), true);
    assert.equal(isYouTubeMixPlaylist('PL1234567890abc'), false);
  });

  it('keeps the current video when parsing a YouTube Mix link', () => {
    assert.deepEqual(parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ?list=RDdQw4w9WgXcQ'), {
      videoId: 'dQw4w9WgXcQ',
      playlistId: 'RDdQw4w9WgXcQ',
    });
  });

  it('rejects non-YouTube URLs', () => {
    assert.equal(parseYouTubeInput('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  });
});
