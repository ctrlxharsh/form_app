/**
 * Question Input Component
 * 
 * Renders the appropriate input element based on question type.
 * Supports side-by-side layout for question image and options with images.
 */

'use client';

import React from 'react';
import type { FormQuestion, QuestionOption } from '@/lib/db';

interface QuestionInputProps {
    question: FormQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    questionNumber: number;
}

export type AnswerValue = {
    text?: string;
    selectedOptions?: number[];
    rankingOrder?: number[];
    file?: File;
};

export function QuestionInput({ question, value, onChange, questionNumber }: QuestionInputProps) {
    const requiredMarker = question.is_required ? ' *' : '';
    const marks = question.marks ? ` [${question.marks} marks]` : '';

    // Check if options have images
    const hasOptionImages = question.options.some(opt => opt.option_image_url);

    return (
        <div className="question-container">
            {/* Question Header */}
            <div className="question-header">
                <span className="question-number">Q{questionNumber}.</span>
                <span className="question-text">{question.question_text}{requiredMarker}</span>
                {marks && <span className="question-marks">{marks}</span>}
            </div>

            {/* Question Image + Content Layout */}
            <div className={`question-body ${question.question_image_url ? 'with-image' : ''}`}>
                {/* Question Image */}
                {question.question_image_url && (
                    <div className="question-image-container">
                        <img
                            src={question.question_image_url}
                            alt="Question"
                            className="question-img"
                        />
                        <a
                            href={question.question_image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="image-link"
                        >
                            Open image
                        </a>
                    </div>
                )}

                {/* Input based on question type */}
                <div className="question-input-area">
                    {renderInput(question, value, onChange, hasOptionImages)}
                </div>
            </div>
        </div>
    );
}

function renderInput(
    question: FormQuestion,
    value: AnswerValue,
    onChange: (value: AnswerValue) => void,
    hasOptionImages: boolean
) {
    switch (question.question_type) {
        case 'mcq':
            return (
                <MCQInput
                    options={question.options}
                    value={value.selectedOptions?.[0]}
                    onChange={(optionId) => onChange({ selectedOptions: optionId ? [optionId] : [] })}
                    hasImages={hasOptionImages}
                />
            );

        case 'multiple_select':
            return (
                <MultipleSelectInput
                    options={question.options}
                    value={value.selectedOptions || []}
                    onChange={(selected) => onChange({ selectedOptions: selected })}
                    hasImages={hasOptionImages}
                />
            );

        case 'true_false':
            return (
                <TrueFalseInput
                    value={value.text}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'fill_blank':
        case 'short_answer':
            return (
                <TextInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'long_answer':
            return (
                <TextAreaInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'numerical':
            return (
                <NumberInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'range':
            return (
                <RangeInput
                    min={question.min_value || 1}
                    max={question.max_value || 10}
                    value={parseInt(value.text || '1', 10)}
                    onChange={(num) => onChange({ text: String(num) })}
                />
            );

        case 'ranking':
            return (
                <RankingInput
                    options={question.options}
                    value={value.rankingOrder || []}
                    onChange={(order) => onChange({ rankingOrder: order })}
                />
            );

        case 'image_upload':
            return (
                <ImageUploadInput
                    value={value.file}
                    onChange={(file) => onChange({ file })}
                />
            );

        default:
            return <p className="text-red-500">Unknown question type: {question.question_type}</p>;
    }
}

// ============ MCQ INPUT ============

function MCQInput({
    options,
    value,
    onChange,
    hasImages
}: {
    options: QuestionOption[];
    value?: number;
    onChange: (optionId: number | undefined) => void;
    hasImages: boolean;
}) {
    return (
        <div className="input-group">
            <p className="input-label">Select one:</p>
            <div className={`options-container ${hasImages ? 'with-images' : ''}`}>
                {options.map((opt, idx) => (
                    <label
                        key={opt.option_id}
                        className={`option-card ${value === opt.option_id ? 'selected' : ''}`}
                    >
                        <div className="option-header">
                            <input
                                type="radio"
                                name={`mcq-${options[0].option_id}`}
                                checked={value === opt.option_id}
                                onChange={() => onChange(opt.option_id)}
                                className="radio-input"
                            />
                            <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                        </div>
                        {opt.option_image_url && (
                            <img src={opt.option_image_url} alt={opt.option_text} className="option-image" />
                        )}
                        {opt.option_text && (
                            <span className="option-text">{opt.option_text}</span>
                        )}
                    </label>
                ))}
            </div>
        </div>
    );
}

// ============ MULTIPLE SELECT INPUT ============

function MultipleSelectInput({
    options,
    value,
    onChange,
    hasImages
}: {
    options: QuestionOption[];
    value: number[];
    onChange: (selected: number[]) => void;
    hasImages: boolean;
}) {
    const toggleOption = (optionId: number) => {
        if (value.includes(optionId)) {
            onChange(value.filter(id => id !== optionId));
        } else {
            onChange([...value, optionId]);
        }
    };

    return (
        <div className="input-group">
            <p className="input-label">Select all that apply:</p>
            <div className={`options-container ${hasImages ? 'with-images' : ''}`}>
                {options.map((opt, idx) => (
                    <label
                        key={opt.option_id}
                        className={`option-card ${value.includes(opt.option_id) ? 'selected' : ''}`}
                    >
                        <div className="option-header">
                            <input
                                type="checkbox"
                                checked={value.includes(opt.option_id)}
                                onChange={() => toggleOption(opt.option_id)}
                                className="checkbox-input"
                            />
                            <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                        </div>
                        {opt.option_image_url && (
                            <img src={opt.option_image_url} alt={opt.option_text} className="option-image" />
                        )}
                        {opt.option_text && (
                            <span className="option-text">{opt.option_text}</span>
                        )}
                    </label>
                ))}
            </div>
        </div>
    );
}

// ============ TRUE/FALSE INPUT ============

function TrueFalseInput({
    value,
    onChange
}: {
    value?: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="input-group">
            <div className="true-false-container">
                {['True', 'False'].map((option) => (
                    <label
                        key={option}
                        className={`tf-option ${value === option ? 'selected' : ''}`}
                    >
                        <input
                            type="radio"
                            checked={value === option}
                            onChange={() => onChange(option)}
                            className="radio-input"
                        />
                        <span>{option}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// ============ TEXT INPUT ============

function TextInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="text-input"
            placeholder="Your answer"
        />
    );
}

// ============ TEXTAREA INPUT ============

function TextAreaInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="textarea-input"
            placeholder="Your answer"
            rows={5}
        />
    );
}

// ============ NUMBER INPUT ============

function NumberInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="number-input"
            placeholder="0"
        />
    );
}

// ============ RANGE INPUT ============

function RangeInput({
    min,
    max,
    value,
    onChange
}: {
    min: number;
    max: number;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="input-group">
            <div className="range-container">
                <span className="range-label">{min}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onChange(parseInt(e.target.value, 10))}
                    className="range-input"
                />
                <span className="range-label">{max}</span>
            </div>
            <p className="range-value">Selected: <strong>{value}</strong></p>
        </div>
    );
}

// ============ RANKING INPUT ============

function RankingInput({
    options,
    value,
    onChange
}: {
    options: QuestionOption[];
    value: number[];
    onChange: (order: number[]) => void;
}) {
    const handleRankChange = (optionId: number, rank: number) => {
        const rankMap = new Map<number, number>();
        options.forEach((opt, idx) => {
            const existingRank = value.indexOf(opt.option_id);
            rankMap.set(opt.option_id, existingRank >= 0 ? existingRank + 1 : idx + 1);
        });

        rankMap.set(optionId, rank);

        const sorted = Array.from(rankMap.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([id]) => id);

        onChange(sorted);
    };

    return (
        <div className="input-group">
            <p className="input-label">Assign rank to each option (1 = highest):</p>
            <div className="ranking-group">
                {options.map((opt) => {
                    const currentRank = value.indexOf(opt.option_id);
                    return (
                        <div key={opt.option_id} className="ranking-option">
                            <div className="ranking-content">
                                <span className="ranking-text">{opt.option_text}</span>
                                {opt.option_image_url && (
                                    <img src={opt.option_image_url} alt={opt.option_text} className="ranking-image" />
                                )}
                            </div>
                            <select
                                value={currentRank >= 0 ? currentRank + 1 : ''}
                                onChange={(e) => handleRankChange(opt.option_id, parseInt(e.target.value, 10))}
                                className="ranking-select"
                            >
                                <option value="">-</option>
                                {options.map((_, idx) => (
                                    <option key={idx + 1} value={idx + 1}>{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============ IMAGE UPLOAD INPUT ============

function ImageUploadInput({
    value,
    onChange
}: {
    value?: File;
    onChange: (file: File | undefined) => void;
}) {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        onChange(file);
    };

    return (
        <div className="input-group">
            <div className="file-upload-container">
                <input
                    type="file"
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={handleFileChange}
                    className="file-input"
                    id="file-upload"
                />
                <label htmlFor="file-upload" className="file-upload-label">
                    📷 Choose Image
                </label>
            </div>
            {value && (
                <div className="file-preview">
                    <span className="file-name">✓ {value.name}</span>
                </div>
            )}
        </div>
    );
}
