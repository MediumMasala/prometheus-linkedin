import React from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// REUSABLE UI BLOCK COMPONENTS FOR CAMPAIGN ROI SECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * MetricBlock - A single metric display block for summary bars
 */
interface MetricBlockProps {
  label: string;
  value: string | number;
  subtext?: string;
  labelColor?: string;
  className?: string;
}

export function MetricBlock({ label, value, subtext, labelColor = 'text-gray-500', className = '' }: MetricBlockProps) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className={`text-xs font-medium uppercase tracking-wide ${labelColor}`}>{label}</span>
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      {subtext && <span className="text-xs text-gray-400 mt-0.5">{subtext}</span>}
    </div>
  );
}

/**
 * MetricBlockCompact - Smaller inline metric for secondary displays
 */
interface MetricBlockCompactProps {
  label: string;
  value: string | number;
  labelColor?: string;
  valueColor?: string;
  className?: string;
}

export function MetricBlockCompact({
  label,
  value,
  labelColor = 'text-gray-400',
  valueColor = 'text-gray-700',
  className = ''
}: MetricBlockCompactProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`text-xs ${labelColor}`}>{label}</span>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}

/**
 * SummaryBar - Layer 1: Horizontal summary bar with metric blocks
 */
interface SummaryBarProps {
  children: React.ReactNode;
  className?: string;
}

export function SummaryBar({ children, className = '' }: SummaryBarProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-4 ${className}`}>
      <div className="flex items-center justify-between gap-6 flex-wrap">
        {children}
      </div>
    </div>
  );
}

/**
 * SummaryBarDivider - Vertical divider for summary bars
 */
export function SummaryBarDivider() {
  return <div className="h-10 w-px bg-gray-200" />;
}

/**
 * MetricRow - Layer 2: Compact row of metric cards
 */
interface MetricRowProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function MetricRow({ title, children, className = '' }: MetricRowProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-4 ${className}`}>
      <div className="flex items-center gap-6 flex-wrap">
        {title && (
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * MetricCard - Small metric card for MetricRow
 */
interface MetricCardProps {
  label: string;
  value: string | number;
  labelColor?: string;
  valueColor?: string;
  highlight?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  labelColor = 'text-gray-400',
  valueColor = 'text-gray-700',
  highlight = false,
  className = ''
}: MetricCardProps) {
  return (
    <div className={`
      px-4 py-2 rounded-lg transition-colors
      ${highlight ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}
      ${className}
    `}>
      <div className="flex flex-col">
        <span className={`text-xs ${highlight ? 'text-blue-500' : labelColor}`}>{label}</span>
        <span className={`text-lg font-bold ${highlight ? 'text-blue-700' : valueColor}`}>{value}</span>
      </div>
    </div>
  );
}

/**
 * AnalyticsCard - Layer 3: Large analytics card with accent color and icon
 */
interface AnalyticsCardProps {
  title: string;
  value: string | number;
  subtext?: React.ReactNode;
  accentColor: 'orange' | 'blue' | 'green' | 'purple' | 'emerald';
  icon: React.ReactNode;
  className?: string;
}

const accentColorMap = {
  orange: {
    border: 'border-l-orange-400',
    label: 'text-orange-600',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-400',
  },
  blue: {
    border: 'border-l-blue-400',
    label: 'text-blue-600',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-400',
  },
  green: {
    border: 'border-l-green-400',
    label: 'text-green-600',
    iconBg: 'bg-green-50',
    iconColor: 'text-green-400',
  },
  purple: {
    border: 'border-l-purple-400',
    label: 'text-purple-600',
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-400',
  },
  emerald: {
    border: 'border-l-emerald-400',
    label: 'text-emerald-600',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-400',
  },
};

export function AnalyticsCard({
  title,
  value,
  subtext,
  accentColor,
  icon,
  className = ''
}: AnalyticsCardProps) {
  const colors = accentColorMap[accentColor];

  return (
    <div className={`
      bg-white rounded-xl shadow-sm
      border-l-4 ${colors.border}
      border-t border-r border-b border-gray-100
      p-6 ${className}
    `}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colors.label}`}>
            {title}
          </p>
          <p className="text-4xl font-bold text-gray-900">{value}</p>
          {subtext && (
            <p className="text-sm text-gray-500 mt-2">{subtext}</p>
          )}
        </div>
        <div className={`p-3 rounded-full ${colors.iconBg}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/**
 * AnalyticsCardsGrid - Grid container for analytics cards
 */
interface AnalyticsCardsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function AnalyticsCardsGrid({ children, columns = 2, className = '' }: AnalyticsCardsGridProps) {
  const colsClass = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  };

  return (
    <div className={`grid grid-cols-1 ${colsClass[columns]} gap-5 ${className}`}>
      {children}
    </div>
  );
}

/**
 * CampaignROISection - Complete Campaign ROI section wrapper
 */
interface CampaignROISectionProps {
  children: React.ReactNode;
  className?: string;
}

export function CampaignROISection({ children, className = '' }: CampaignROISectionProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ICON COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

export function CurrencyIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

export function DocumentIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

export function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}
