import { useState } from "react";
import { Download, FileAudio, FileImage, FileText, FileVideo, LoaderCircle } from "lucide-react";
import { api, apiBlob } from "../api";
import { useNotifications } from "../notifications";
import type { Resource } from "../types";

function iconFor(type: string) {
  if (type === "image") return <FileImage size={12} />;
  if (type === "audio") return <FileAudio size={12} />;
  if (type === "video") return <FileVideo size={12} />;
  return <FileText size={12} />;
}

export default function ResourceMedia({ resource }: { resource: Resource }) {
  const notifications = useNotifications();
  const type = resource.resource_type.toLowerCase();
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState("");

  const setResourceError = (message: string) => {
    setError(message);
    notifications.showToast({
      kind: "error",
      title: "Resource unavailable",
      message,
    });
  };

  const downloadFile = async () => {
    setDownloadBusy(true);
    try {
      const blob = await apiBlob(`/courses/resources/${resource.id}/media?download=true`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = resource.original_filename || resource.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      notifications.showToast({ kind: "success", title: "Download started", message: `${resource.original_filename || resource.title} is downloading.` });
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (cause) {
      setResourceError((cause as Error).message || "Resource is not available");
    } finally {
      setDownloadBusy(false);
    }
  };

  const actions = <div className="resource-actions"><button className="resource-pill resource-open-button" type="button" disabled={downloadBusy} onClick={() => void downloadFile()}>{downloadBusy ? <LoaderCircle size={12} className="spin" /> : <Download size={12} />} {downloadBusy ? "Downloading…" : "Download"}</button></div>;

  return <div className="resource-media"><div className="resource-file-label">{iconFor(type)} <span title={resource.original_filename}>{resource.original_filename || resource.title}</span></div>{error && <span className="resource-media-status form-error">{error}</span>}{actions}</div>;
}
