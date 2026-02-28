interface DatePickerProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="date" className="text-sm font-medium text-gray-700">
        Select Date:
      </label>
      <input
        type="date"
        id="date"
        value={selectedDate}
        max={today}
        onChange={(e) => onDateChange(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {selectedDate && (
        <button
          onClick={() => onDateChange('')}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Clear (show all time)
        </button>
      )}
    </div>
  );
}
