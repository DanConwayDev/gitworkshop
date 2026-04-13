/**
 * remarkBareMediaUrls — remark plugin for Nostr-style bare media embeds.
 *
 * In Nostr, images and videos are embedded by pasting a bare URL on its own
 * line rather than using markdown ![alt](url) syntax. remarkGfm auto-links
 * these into `link` nodes which would otherwise render as <a> tags.
 *
 * This plugin walks the mdast and converts any auto-linked bare URL (where
 * the link text equals the URL) pointing to an image or video extension into
 * an `image` node so that react-markdown renders it as <img>/<video>.
 *
 * Video URLs are represented as image nodes with alt="__video__" so that the
 * `img` component override can render a <video controls> element instead.
 */

import { isImageURL, isVideoURL } from "applesauce-core/helpers";

// Minimal mdast node types — defined inline to avoid a direct `mdast` dep.
interface MdastNode {
  type: string;
}
interface MdastParent extends MdastNode {
  children: MdastNode[];
}
interface MdastText extends MdastNode {
  type: "text";
  value: string;
}
interface MdastLink extends MdastParent {
  type: "link";
  url: string;
  children: MdastNode[];
}
interface MdastImage extends MdastNode {
  type: "image";
  url: string;
  alt: string;
  title: string | null;
}
interface MdastRoot extends MdastParent {
  type: "root";
}

function walkParent(node: MdastParent) {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (child.type === "link") {
      const link = child as MdastLink;
      const url = link.url;

      // Only convert auto-linked bare URLs (link text === url)
      const linkText =
        link.children.length === 1 && link.children[0].type === "text"
          ? (link.children[0] as MdastText).value
          : null;
      if (linkText !== url) continue;

      if (isImageURL(url)) {
        const imageNode: MdastImage = {
          type: "image",
          url,
          alt: "",
          title: null,
        };
        node.children.splice(i, 1, imageNode);
      } else if (isVideoURL(url)) {
        const videoNode: MdastImage = {
          type: "image",
          url,
          alt: "__video__",
          title: null,
        };
        node.children.splice(i, 1, videoNode);
      }
    } else if ("children" in child) {
      walkParent(child as MdastParent);
    }
  }
}

/**
 * Remark plugin that converts bare image/video URLs (auto-linked by remarkGfm)
 * into image nodes. Video URLs become image nodes with alt="__video__" so the
 * `img` component override can render a <video> element instead.
 */
export function remarkBareMediaUrls() {
  return (tree: MdastRoot) => {
    walkParent(tree);
  };
}
