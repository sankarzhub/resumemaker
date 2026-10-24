import { Schema, model, Types, type InferSchemaType } from 'mongoose';

const categorySchema = new Schema(
  {
    key: String,
    label: String,
    earned: Number,
    max: Number,
    reasons: [String],
  },
  { _id: false },
);

const analysisSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    resumeId: { type: Types.ObjectId, ref: 'Resume', required: true, index: true },
    kind: { type: String, enum: ['quality', 'job-match'], required: true },
    jobDescription: { type: String, maxlength: 20000 },
    score: { type: Number, required: true, min: 0, max: 100 },
    breakdown: { type: [categorySchema], default: [] },
    matchedSkills: { type: [String], default: [] },
    relatedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    suggestions: { type: [String], default: [] },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// History lookups and pruning read a resume's newest reports first.
analysisSchema.index({ resumeId: 1, createdAt: -1 });

export type AnalysisAttrs = InferSchemaType<typeof analysisSchema>;
export const Analysis = model('Analysis', analysisSchema);
