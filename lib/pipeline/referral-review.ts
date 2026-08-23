export type ReviewStep = 1 | 2 | 3 | 4;

export type ReviewItem = {
  label: string;
  value: string;
  step: ReviewStep;
  sensitive?: boolean;
};

export type ReviewSection = {
  label: string;
  items: ReviewItem[];
};

export type ReviewSummary = {
  complete: number;
  total: number;
  percent: number;
  sections: Array<{
    label: string;
    complete: number;
    total: number;
  }>;
};

export function reviewField(
  label: string,
  value: string,
  step: ReviewStep,
  sensitive = false,
): ReviewItem {
  return { label, value, step, sensitive };
}

export function isReviewItemComplete(item: ReviewItem): boolean {
  return item.value.trim().length > 0;
}

export function summarizeReviewSections(sections: ReviewSection[]): ReviewSummary {
  const sectionSummaries = sections.map((section) => ({
    label: section.label,
    complete: section.items.filter(isReviewItemComplete).length,
    total: section.items.length,
  }));
  const complete = sectionSummaries.reduce((sum, section) => sum + section.complete, 0);
  const total = sectionSummaries.reduce((sum, section) => sum + section.total, 0);

  return {
    complete,
    total,
    percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    sections: sectionSummaries,
  };
}
