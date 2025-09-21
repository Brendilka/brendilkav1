# Schedule Template Format Documentation

## File Format
- Supported formats: CSV (.csv) or TXT (.txt)
- Comma-separated values
- First line must be header: Week,Day,StartTime,EndTime,ShiftType

## Field Descriptions

### Week
- Numeric value starting from 0
- 0 = First week of pattern
- 1 = Second week of pattern
- 2 = Third week of pattern, etc.

### Day
- Numeric value 0-6
- 0 = Monday
- 1 = Tuesday
- 2 = Wednesday
- 3 = Thursday
- 4 = Friday
- 5 = Saturday
- 6 = Sunday

### StartTime
- 24-hour format (HH:MM)
- Example: 08:00, 14:30, 22:15
- Leave empty for days off

### EndTime
- 24-hour format (HH:MM)
- Example: 16:00, 22:30, 06:15
- Leave empty for days off

### ShiftType
- Options:
  - "day" = Day shift (blue background)
  - "night" = Night shift (purple background)
  - "leave" = Leave/Off day (yellow background)

## Example Templates

### Basic 1-Week Pattern (Day Shifts)
```
Week,Day,StartTime,EndTime,ShiftType
0,0,08:00,16:00,day
0,1,08:00,16:00,day
0,2,08:00,16:00,day
0,3,08:00,16:00,day
0,4,08:00,16:00,day
0,5,,off,leave
0,6,,off,leave
```

### 2-Week Rotating Pattern (Day/Night)
```
Week,Day,StartTime,EndTime,ShiftType
0,0,08:00,16:00,day
0,1,08:00,16:00,day
0,2,08:00,16:00,day
0,3,08:00,16:00,day
0,4,08:00,16:00,day
0,5,,off,leave
0,6,,off,leave
1,0,20:00,04:00,night
1,1,20:00,04:00,night
1,2,20:00,04:00,night
1,3,20:00,04:00,night
1,4,20:00,04:00,night
1,5,,off,leave
1,6,,off,leave
```

### 3-Week Complex Pattern
```
Week,Day,StartTime,EndTime,ShiftType
0,0,06:00,14:00,day
0,1,06:00,14:00,day
0,2,06:00,14:00,day
0,3,06:00,14:00,day
0,4,06:00,14:00,day
0,5,,off,leave
0,6,,off,leave
1,0,14:00,22:00,day
1,1,14:00,22:00,day
1,2,14:00,22:00,day
1,3,14:00,22:00,day
1,4,14:00,22:00,day
1,5,,off,leave
1,6,,off,leave
2,0,22:00,06:00,night
2,1,22:00,06:00,night
2,2,22:00,06:00,night
2,3,22:00,06:00,night
2,4,22:00,06:00,night
2,5,,off,leave
2,6,,off,leave
```

## Usage Instructions

1. Create your template file using any text editor or Excel
2. Save as .csv or .txt format
3. In the schedule management page, click "Upload Template" for the desired employee
4. Select your template file
5. The schedule will be automatically applied

## Tips
- You can download a template first to see the exact format
- Test with simple patterns before creating complex ones
- Empty StartTime/EndTime with "leave" ShiftType creates days off
- Make sure Week numbers match your employee's pattern setting
- Time format must be HH:MM (24-hour)
