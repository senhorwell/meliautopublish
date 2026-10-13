export type JobStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "optimizing"
  | "optimized"
  | "publishing"
  | "success"
  | "failed";

export type ExtractedItem = {
  id: string;
  title: string;
  price: number;
  currencyId: string;
  categoryId: string;
  condition: string;
  permalink: string;
  availableQuantity: number;
  listingTypeId?: string;
  siteId: string;
  pictures: string[];
  attributes: {
    id: string;
    name?: string;
    value_id?: string | null;
    value_name?: string | null;
  }[];
  description: string;
};

export type OptimizedListing = {
  title: string;
  description: string;
  suggested_price_multiplier: number;
};

export type PipelineEvent =
  | { type: "started"; url: string; itemId: string | null; jobId: string }
  | {
      type: "step";
      url: string;
      jobId: string;
      status: JobStatus;
      message: string;
    }
  | {
      type: "success";
      url: string;
      jobId: string;
      mlItemId: string;
      permalink: string;
      title: string;
      price: number;
      suggestedPrice: number;
      currencyId: string;
    }
  | { type: "error"; url?: string; jobId?: string; message: string }
  | { type: "done" };
