export type XMedia = { mediaKey: string; type: string; url: string | null; previewImageUrl: string | null; altText: string | null };
export type XPost = { id: string; text: string; createdAt: string | null; url: string; media: XMedia[]; canonicalId?: string; textNotice?: string; hasArticle?: boolean };
