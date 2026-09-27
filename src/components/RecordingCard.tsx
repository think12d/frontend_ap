import { useEffect, useState } from "react";
import { Calendar, Clock, ExternalLink, Film, Play, RefreshCw } from "lucide-react";
import { api, apiBlob, ApiError, API_URL } from "../api";
import { useNotifications } from "../notifications";

export interface RecordingCardData {
  liveClassId: number;
  recordingId?: number;
  title: string;
  topic?: string | null;
  date: string;
  durationSeconds?: number | null;
  paymentUrl?: string;
}

type RecordingSegment = {
  recording_id: number;
  file_name?: string | null;
  duration?: number | null;
  status: string;
};

type ClassRecordingResponse = {
  recording_id: number;
  recordings?: RecordingSegment[];
};

function formatDuration(seconds?: number | null): string {
  if (!seconds) return "Full Session";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function chooseSegment(recording: ClassRecordingResponse, preferredId?: number | null) {
  const segments = recording.recordings?.length
    ? recording.recordings
    : [{ recording_id: recording.recording_id, status: "COMPLETED" }];
  const selected = segments.find((segment) => segment.recording_id === preferredId) ?? segments[0];
  return { segments, selected };
}

export default function RecordedClassCard({ data }: { data: RecordingCardData }) {
  const notifications = useNotifications();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(data.recordingId ?? null);

  useEffect(() => () => {
    if (mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(mediaUrl);
  }, [mediaUrl]);

  const handleWatch = async () => {
    setLoading(true);
    setError(null);
    try {
      const recording = await api<ClassRecordingResponse>(`/live-classes/${data.liveClassId}/recording`);
      const { segments: availableSegments, selected } = chooseSegment(
        recording,
        selectedSegmentId ?? data.recordingId,
      );
      setSegments(availableSegments);
      setSelectedSegmentId(selected.recording_id);

      const blob = await apiBlob(`/recordings/${selected.recording_id}/media`);
      setMediaUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return URL.createObjectURL(blob);
      });
      notifications.showToast({
        kind: "success",
        title: "Replay ready",
        message: "Your recorded class is ready to watch.",
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError("Sign in with Google to unlock this recording");
      } else if (cause instanceof ApiError && cause.status === 402) {
        setError("This recording is available to learners who registered and paid for this batch");
      } else {
        setError((cause as Error).message || "Drive recording is currently processing. Please check back shortly.");
      }
    } finally {
      setLoading(false);
    }
  };

  const openInDrive = async () => {
    const driveWindow = window.open("about:blank", "_blank");
    if (driveWindow) driveWindow.opener = null;
    setDriveBusy(true);
    setError(null);
    try {
      const recording = await api<ClassRecordingResponse>(`/live-classes/${data.liveClassId}/recording`);
      const { segments: availableSegments, selected } = chooseSegment(
        recording,
        selectedSegmentId ?? data.recordingId,
      );
      setSegments(availableSegments);
      setSelectedSegmentId(selected.recording_id);
      if (!selected.file_name) {
        throw new Error("This recording cannot be matched to its private Drive file.");
      }

      const library = await api<{
        items: { id: string; name: string; live_class_id?: number | null }[];
      }>("/library/recorded-videos");
      const matches = library.items.filter(
        (item) => item.live_class_id === data.liveClassId && item.name === selected.file_name,
      );
      if (matches.length !== 1) {
        throw new Error("Could not uniquely match this recording to its private Drive file.");
      }

      const grant = await api<{ url: string; expires_at?: string | null; expiration_supported?: boolean }>(
        `/library/recorded-videos/${encodeURIComponent(matches[0].id)}/drive-view`,
        { method: "POST" },
      );
      const driveUrl = new URL(grant.url);
      if (driveUrl.protocol !== "https:" || driveUrl.hostname !== "drive.google.com") {
        throw new Error("Google Drive returned an unexpected recording link.");
      }
      if (driveWindow) driveWindow.location.replace(driveUrl.href);
      notifications.showToast({
        kind: "info",
        title: "Opening Drive copy",
        message: grant.expiration_supported === false
          ? "This Drive file does not support automatic access expiry. Its permission must be revoked manually."
          : grant.expires_at
          ? `Drive access is granted to your verified Google account until ${new Date(grant.expires_at).toLocaleDateString()}.`
          : "Drive access is granted to your verified Google account.",
      });
    } catch (cause) {
      driveWindow?.close();
      const message = (cause as Error).message || "Google Drive access could not be granted.";
      setError(message);
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <article className="recording-card modern-card">
      <div className="recording-card-header">
        <div className="recording-badge-row">
          <span className="replay-chip">
            <Film size={12} /> ARCHIVE REPLAY
          </span>
          <span className="duration-tag">
            <Clock size={11} /> {formatDuration(data.durationSeconds)}
          </span>
        </div>
        <h3 className="recording-title">{data.title}</h3>
        <p className="recording-topic"><strong>Topic:</strong> {data.topic || data.title}</p>
        <p className="recording-date">
          <Calendar size={12} /> {new Date(data.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {error && (
        <div className="notice notice-error small-notice">
          <span>{error}</span>
          {(error === "Sign in with Google to unlock this recording" || error.toLowerCase().includes("verify your google account")) && (
            <button className="button button-cyan button-small" type="button" onClick={() => window.location.assign(`${API_URL}/auth/google/login`)}>
              Continue with Google
            </button>
          )}
          {error === "This recording is available to learners who registered and paid for this batch" && data.paymentUrl && (
            <a className="button button-cyan button-small" href={data.paymentUrl}>Register and pay</a>
          )}
        </div>
      )}

      {mediaUrl && (
        <div className="video-player-container">
          <video className="recording-player" controls autoPlay preload="metadata" src={mediaUrl} />
        </div>
      )}

      {segments.length > 1 && (
        <label className="recording-segment-picker">
          Recording segment
          <select
            value={selectedSegmentId ?? segments[0].recording_id}
            onChange={(event) => {
              setSelectedSegmentId(Number(event.target.value));
              setMediaUrl(null);
            }}
          >
            {segments.map((segment, index) => (
              <option value={segment.recording_id} key={segment.recording_id}>
                Segment {index + 1}{segment.file_name ? ` · ${segment.file_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="recording-card-actions">
        <button
          className={`button full ${mediaUrl ? "button-outline" : "button-cyan"}`}
          type="button"
          onClick={() => void handleWatch()}
          disabled={loading}
        >
          {loading ? (
            <>
              <RefreshCw size={14} className="spin" /> Preparing Stream...
            </>
          ) : mediaUrl ? (
            <>
              <RefreshCw size={14} /> Reload Replay
            </>
          ) : (
            <>
              <Play size={14} /> Watch Drive Recording
            </>
          )}
        </button>
        <button className="button button-outline button-small" type="button" onClick={() => void openInDrive()} disabled={driveBusy}>
          <ExternalLink size={14} /> {driveBusy ? "Granting…" : "Open in Drive"}
        </button>
      </div>
    </article>
  );
}
