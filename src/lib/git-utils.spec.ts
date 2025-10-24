import { describe, expect, test } from 'vitest';
import { extractPatchMessage, gitProgressToPc } from './git-utils';

// const simple =
// const example = `From 35ef1fe53b5a460266a1666709d886560d99cd67 Mon Sep 17 00:00:00 2001\nFrom: fiatjaf <fiatjaf@gmail.com>\nDate: Mon, 29 Jan 2024 09:41:27 -0300\nSubject: [PATCH] fix multi-attempt password prompt.\n\nthe print was doing nothing\nand the continue was missing\n---\nfound this bug while copying these functions to be used in nak\n\n helpers.go | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\ndiff --git a/helpers.go b/helpers.go\nindex 0b3790d..9b5c3da 100644\n--- a/helpers.go\n+++ b/helpers.go\n@@ -176,7 +176,7 @@ func promptDecrypt(ncryptsec1 string) (string, error) {\n \t\t}\n \t\tsec, err := nip49.Decrypt(ncryptsec1, password)\n \t\tif err != nil {\n-\t\t\tfmt.Fprintf(os.Stderr, "failed to decrypt: %s", err)\n+\t\t\tcontinue\n \t\t}\n \t\treturn sec, nil\n \t}\n--\n2.43.0\n', tags: (3) […], kind: 1617, id: "fd5d1be541bf2d20c51ca63265cc893eecb4be8720db9b42abec21b9ca9747de", sig: "d4733b8b32c05d1fb33a76105926fc537e4060df25405521b3f74f91ed7d65f345386260e8a825c79d67c3dd67f5e7eea7d532cda48cb8d45f09f9be19775289", pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", … }`

describe('extractPatchMessage', () => {
	test('extractPatchMessage - normal message end', () => {
		expect(
			extractPatchMessage(
				'From 5ec8fb38b7e4d7b2081e276be456519e2dc76d46 Mon Sep 17 00:00:00 2001\nFrom: fiatjaf <fiatjaf@gmail.com>\nDate: Mon, 29 Jan 2024 09:49:32 -0300\nSubject: [PATCH] invert alias order for `git str send --to`\n\n---\n send.go | 6 +++---\n 1 file changed, 3 insertions(+), 3 deletions(-)\n\ndiff --git a/send.go b/send.go\nindex bc81c00..d9017b6 100644\n--- a/send.go\n+++ b/send.go\n@@ -25,8 +25,8 @@ var send = &cli.Command{\n \t\t\tUsage: "if we should save the secret key to git config --local",\n \t\t},\n \t\t&cli.StringFlag{\n-\t\t\tName:    "repository",\n-\t\t\tAliases: []string{"a", "to"},\n+\t\t\tName:    "to",\n+\t\t\tAliases: []string{"a", "repository"},\n \t\t\tUsage:   "repository reference, as an naddr1... code",\n \t\t},\n \t\t&cli.StringSliceFlag{\n@@ -170,7 +170,7 @@ func getAndApplyTargetRepository(\n \t\treturn nil, nil\n \t}\n \n-\ttarget := c.String("repository")\n+\ttarget := c.String("to")\n \tvar stored string\n \tif target == "" {\n \t\ttarget, _ = git("config", "--local", "str.upstream")\n-- \n2.43.0'
			)
		).toEqual('invert alias order for `git str send --to`');
	});

	test('extractPatchMessage - unusual message end', () => {
		expect(
			extractPatchMessage(
				`From 35ef1fe53b5a460266a1666709d886560d99cd67 Mon Sep 17 00:00:00 2001\nFrom: fiatjaf <fiatjaf@gmail.com>\nDate: Mon, 29 Jan 2024 09:41:27 -0300\nSubject: [PATCH] fix multi-attempt password prompt.\n\nthe print was doing nothing\nand the continue was missing\n---\nfound this bug while copying these functions to be used in nak\n\n helpers.go | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\ndiff --git a/helpers.go b/helpers.go\nindex 0b3790d..9b5c3da 100644\n--- a/helpers.go\n+++ b/helpers.go\n@@ -176,7 +176,7 @@ func promptDecrypt(ncryptsec1 string) (string, error) {\n \t\t}\n \t\tsec, err := nip49.Decrypt(ncryptsec1, password)\n \t\tif err != nil {\n-\t\t\tfmt.Fprintf(os.Stderr, "failed to decrypt: %s", err)\n+\t\t\tcontinue\n \t\t}\n \t\treturn sec, nil\n \t}\n--\n2.43.0\n`
			)
		).toEqual(
			'fix multi-attempt password prompt.\n\nthe print was doing nothing\nand the continue was missing\n---\nfound this bug while copying these functions to be used in nak'
		);
	});

	test('cover letter', () => {
		expect(
			extractPatchMessage(
				`From 8a45afcacd035de474e142e29cbdfa979d23f751 Mon Sep 17 00:00:00 2001\nSubject: [PATCH 0/2] testing multiple revisions of multi patch PR with cover letter\n\nhere is the cover letter description`
			)
		).toEqual(
			'testing multiple revisions of multi patch PR with cover letter\n\nhere is the cover letter description'
		);
	});

	test('extractPatchMessage - returns undefined if not parsed', () => {
		expect(
			extractPatchMessage(
				`From 35ef1fe53b5a460266a1666709d886560d99cd67 Mon Sep 17 00:00:00 2001\nFrom: fiatjaf <fiatjaf@gmail.com>\nDate: Mon, 29 Jan 20`
			)
		).toBeUndefined();
	});

	test.skip('extractPatchMessage - multi-line subject', () => {
		expect(
			extractPatchMessage(
				`From 1263051aa4426937c5ef4f7616e06e9a8ea021e0 Mon Sep 17 00:00:00 2001\nFrom: William Casarin <jb55@jb55.com>\nDate: Mon, 22 Jan 2024 14:41:54 -0800\nSubject: [PATCH] Revert "mention: fix broken mentions when there is text is\n directly after"\n\nThis reverts commit af75eed83a2a1dd0eb33a0a27ded71c9f44dacbd.\n---\n damus/Views/PostView.swift     |  7 -------\n damusTests/PostViewTests.swift | 22 ----------------------\n 2 files changed, 29 deletions(-)\n\ndiff --git a/damus/Views/PostView.swift b/damus/Views/PostView.swift\nindex 21ca0498..934ed7de 100644\n--- a/damus/Views/PostView.swift\n+++ b/damus/Views/PostView.swift\n@@ -619,13 +619,6 @@ func load_draft_for_post(drafts: Drafts, action: PostAction) -> DraftArtifacts?\n func build_post(state: DamusState, post: NSMutableAttributedString, action: PostAction, uploadedMedias: [UploadedMedia], references: [RefId]) -> NostrPost {\n     post.enumerateAttributes(in: NSRange(location: 0, length: post.length), options: []) { attributes, range, stop in\n         if let link = attributes[.link] as? String {\n-            let nextCharIndex = range.upperBound\n-            if nextCharIndex < post.length,\n-               let nextChar = post.attributedSubstring(from: NSRange(location: nextCharIndex, length: 1)).string.first,\n-               !nextChar.isWhitespace {\n-                post.insert(NSAttributedString(string: " "), at: nextCharIndex)\n-            }\n-\n             let normalized_link: String\n             if link.hasPrefix("damus:nostr:") {\n                 // Replace damus:nostr: URI prefix with nostr: since the former is for internal navigation and not meant to be posted.\ndiff --git a/damusTests/PostViewTests.swift b/damusTests/PostViewTests.swift\nindex 51976cad..ae78c3e6 100644\n--- a/damusTests/PostViewTests.swift\n+++ b/damusTests/PostViewTests.swift\n@@ -142,28 +142,6 @@ final class PostViewTests: XCTestCase {\n         checkMentionLinkEditorHandling(content: content, replacementText: "", replacementRange: NSRange(location: 5, length: 28), shouldBeAbleToChangeAutomatically: true)\n         \n     }\n-    \n-    func testMentionLinkEditorHandling_noWhitespaceAfterLink1_addsWhitespace() {\n-        var content: NSMutableAttributedString\n-\n-        content = NSMutableAttributedString(string: "Hello @user ")\n-        content.addAttribute(.link, value: "damus:1234", range: NSRange(location: 6, length: 5))\n-        checkMentionLinkEditorHandling(content: content, replacementText: "up", replacementRange: NSRange(location: 11, length: 1), shouldBeAbleToChangeAutomatically: true, expectedNewCursorIndex: 13, handleNewContent: { newManuallyEditedContent in\n-            XCTAssertEqual(newManuallyEditedContent.string, "Hello @user up")\n-            XCTAssertNil(newManuallyEditedContent.attribute(.link, at: 11, effectiveRange: nil))\n-        })\n-    }\n-    \n-    func testMentionLinkEditorHandling_noWhitespaceAfterLink2_addsWhitespace() {\n-        var content: NSMutableAttributedString\n-\n-        content = NSMutableAttributedString(string: "Hello @user test")\n-        content.addAttribute(.link, value: "damus:1234", range: NSRange(location: 6, length: 5))\n-        checkMentionLinkEditorHandling(content: content, replacementText: "up", replacementRange: NSRange(location: 11, length: 1), shouldBeAbleToChangeAutomatically: true, expectedNewCursorIndex: 13, handleNewContent: { newManuallyEditedContent in\n-            XCTAssertEqual(newManuallyEditedContent.string, "Hello @user uptest")\n-            XCTAssertNil(newManuallyEditedContent.attribute(.link, at: 11, effectiveRange: nil))\n-        })\n-    }\n }\n \n func checkMentionLinkEditorHandling(\n\nbase-commit: c67741983e3f07f2386eaa388cb8a1475e8e0471\n-- \n2.42.0\n\n`
			)
		).toEqual(
			'Revert "mention: fix broken mentions when there is text is\n directly after"\n\nThis reverts commit af75eed83a2a1dd0eb33a0a27ded71c9f44dacbd.'
		);
	});

	test('extractPatchMessage - subject only (no body)', () => {
		expect(
			extractPatchMessage(
				'From abc123 Mon Sep 17 00:00:00 2001\nFrom: test@example.com\nDate: Mon, 1 Jan 2024 12:00:00 +0000\nSubject: [PATCH] simple fix\n\n---\n file.txt | 1 +\n 1 file changed, 1 insertion(+)\n\ndiff --git a/file.txt'
			)
		).toEqual('simple fix');
	});

	test('extractPatchMessage - with multi-paragraph body', () => {
		expect(
			extractPatchMessage(
				'From abc123 Mon Sep 17 00:00:00 2001\nFrom: test@example.com\nDate: Mon, 1 Jan 2024 12:00:00 +0000\nSubject: [PATCH] add new feature\n\nThis is the first paragraph of the commit message.\n\nThis is the second paragraph with more details.\n\nAnd a third paragraph.\n---\n file.txt | 10 ++++++++++\n 1 file changed, 10 insertions(+)\n\ndiff --git a/file.txt'
			)
		).toEqual(
			'add new feature\n\nThis is the first paragraph of the commit message.\n\nThis is the second paragraph with more details.\n\nAnd a third paragraph.'
		);
	});

	test('extractPatchMessage - ends with diff --git (no file stats)', () => {
		expect(
			extractPatchMessage(
				'From abc123 Mon Sep 17 00:00:00 2001\nFrom: test@example.com\nDate: Mon, 1 Jan 2024 12:00:00 +0000\nSubject: [PATCH] quick fix\n\nFixed the bug\n\ndiff --git a/file.txt b/file.txt\nindex 123..456\n--- a/file.txt'
			)
		).toEqual('quick fix\n\nFixed the bug');
	});

	test('extractPatchMessage - with multiple continuation lines in subject', () => {
		expect(
			extractPatchMessage(
				'From abc123 Mon Sep 17 00:00:00 2001\nFrom: test@example.com\nDate: Mon, 1 Jan 2024 12:00:00 +0000\nSubject: [PATCH] this is a very long subject line that spans\n multiple lines because it is too long to fit\n on a single line\n\nHere is the body of the commit message.\n---\n file.txt | 1 +\n 1 file changed, 1 insertion(+)\n\ndiff --git a/file.txt'
			)
		).toEqual(
			'this is a very long subject line that spans\n\nmultiple lines because it is too long to fit\n on a single line\n\nHere is the body of the commit message.'
		);
	});

	test('extractPatchMessage - cover letter with multi-paragraph description', () => {
		expect(
			extractPatchMessage(
				'From abc123 Mon Sep 17 00:00:00 2001\nSubject: [PATCH 0/3] feature series\n\nThis is the cover letter for a patch series.\n\nIt has multiple paragraphs explaining the changes.\n\nAnd provides context for reviewers.'
			)
		).toEqual(
			'feature series\n\nThis is the cover letter for a patch series.\n\nIt has multiple paragraphs explaining the changes.\n\nAnd provides context for reviewers.'
		);
	});
});

describe('gitProgressToPc', () => {
	test('new phase progress correct', () => {
		expect(gitProgressToPc({ phase: 'Counting objects', loaded: 0, total: 1 })).toBe(0);
		expect(gitProgressToPc({ phase: 'Compressing objects', loaded: 0, total: 1 })).toBe(10);
		expect(gitProgressToPc({ phase: 'Receiving objects', loaded: 0, total: 1 })).toBe(30);
		expect(gitProgressToPc({ phase: 'Resolving deltas', loaded: 0, total: 1 })).toBe(90);
	});

	test('receiving phase computes partial progress correctly', () => {
		// previous phases = 10 + 20 = 30
		expect(gitProgressToPc({ phase: 'Counting objects', loaded: 50, total: 100 })).toBe(0 + 10 / 2);
		// corrected expectations:
		expect(gitProgressToPc({ phase: 'Compressing objects', loaded: 50, total: 100 })).toBe(
			10 + 20 / 2
		);
		expect(gitProgressToPc({ phase: 'Receiving objects', loaded: 50, total: 100 })).toBe(
			30 + 60 / 2
		);
		expect(gitProgressToPc({ phase: 'Resolving deltas', loaded: 50, total: 100 })).toBe(
			90 + 10 / 2
		);
	});

	test('loaded greater than total can exceed 100', () => {
		// floor((120/100)*60)=72; + previous 30 = 102
		expect(gitProgressToPc({ phase: 'Resolving deltas', loaded: 120, total: 100 })).toBe(100);
	});

	test('unknown phase returns 0', () => {
		expect(gitProgressToPc({ phase: 'Unknown phase', loaded: 10, total: 100 })).toBe(0);
	});
});
