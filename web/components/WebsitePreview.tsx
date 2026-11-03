"use client";
import Icon from "./Icon";

// A business's own website shown beside its details (desktop): scroll and click through it here, or
// open it in a new tab. Sandboxed: the site can run and use forms, but can't open windows, download
// files or navigate our page.
export default function WebsitePreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  return (
    <div className="site-preview" role="dialog" aria-label={`${name} website`}>
      <div className="site-preview-bar">
        <Icon name="globe" size={15} />
        <span className="site-preview-host" title={url}>{host}</span>
        <a className="link-btn" href={url} target="_blank" rel="nofollow noopener noreferrer">Open in new tab <Icon name="external" size={13} /></a>
        <button type="button" className="signin-close" aria-label="Close website preview" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <iframe src={url} title={`${name} website`} sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer" loading="lazy" />
    </div>
  );
}
