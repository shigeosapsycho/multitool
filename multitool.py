#!/usr/bin/env python3
"""
Brandon's MultiTool - A terminal-based multi-tool application
"""

import os
import sys
import tkinter as tk
from tkinter import filedialog
from collections import Counter
from datetime import datetime
import random

__version__ = "1.2.3"

# Resolve output dir relative to the running exe (or script when unfrozen)
if getattr(sys, 'frozen', False):
    _BASE_DIR = os.path.dirname(sys.executable)
else:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))

OUTPUT_DIR = os.path.join(_BASE_DIR, "output")


def ensure_output_dir():
    """Create the output directory on startup if missing."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def clear_screen():
    """Clear the console screen."""
    os.system('cls')


def save_results(results, task_name):
    """Save results to the output directory with auto-generated filename."""
    timestamp = datetime.now().strftime("%m%d%Y_%H%M%S")
    filename = f"{task_name}_{timestamp}.txt"
    save_path = os.path.join(OUTPUT_DIR, filename)

    try:
        with open(save_path, 'w', encoding='utf-8') as f:
            for result in results:
                f.write(str(result) + '\n')

        print(f"Results saved to: {save_path}")
        return True
    except Exception as e:
        print(f"Error saving file: {e}")
        return False


def find_duplicates():
    """Find duplicates in a text file."""
    # Create file dialog for file selection
    print("Select file...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select a text file",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    # Check if user cancelled the dialog
    if not file_path:
        return

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    try:
        # Read the file and extract content
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        # Extract the content part (after the first tab/space if present)
        content_list = []
        for line in lines:
            line = line.strip()
            if line:
                # Split by tab or space and take the last part as content
                parts = line.split('\t') if '\t' in line else line.split(None, 1)
                if len(parts) > 1:
                    content_list.append(parts[1])
                else:
                    content_list.append(parts[0])

        # Count occurrences
        counter = Counter(content_list)

        # Find duplicates (items that appear more than once)
        duplicates = [item for item, count in counter.items() if count > 1]

        # Display results
        if duplicates:
            print("Duplicates:")
            for duplicate in duplicates:
                print(duplicate)
        else:
            print("No duplicates found.")

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1' and duplicates:
            save_results(duplicates, "duplicates")
        # Immediately return to menu after saving (both Yes and No)
        # If user chooses "2" (No), immediately return to menu without prompt

    except Exception as e:
        print(f"Error reading file: {e}")


def find_duplicates_two_files():
    """Find duplicates between two text files."""
    # Select first file
    print("Select file 1...")
    root1 = tk.Tk()
    root1.withdraw()
    root1.attributes('-topmost', True)

    file_path1 = filedialog.askopenfilename(
        title="Select .txt file 1",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root1.destroy()

    # Check if user cancelled the dialog
    if not file_path1:
        return

    # Check if file exists
    if not os.path.exists(file_path1):
        print(f"Error: File 1 not found.")
        return

    # Select second file
    print("Select file 2...")
    root2 = tk.Tk()
    root2.withdraw()
    root2.attributes('-topmost', True)

    file_path2 = filedialog.askopenfilename(
        title="Select .txt file 2",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root2.destroy()

    # Check if user cancelled the dialog
    if not file_path2:
        return

    # Check if file exists
    if not os.path.exists(file_path2):
        print(f"Error: File 2 not found.")
        return

    try:
        # Read both files and extract content
        with open(file_path1, 'r', encoding='utf-8') as f:
            lines1 = f.readlines()

        with open(file_path2, 'r', encoding='utf-8') as f:
            lines2 = f.readlines()

        if not lines1:
            print(f"Error: File 1 is empty.")
            return

        if not lines2:
            print(f"Error: File 2 is empty.")
            return

        # Extract content from both files
        def extract_content(lines):
            content_list = []
            for line in lines:
                line = line.strip()
                if line:
                    # Split by tab or space and take the last part as content
                    parts = line.split('\t') if '\t' in line else line.split(None, 1)
                    if len(parts) > 1:
                        content_list.append(parts[1])
                    else:
                        content_list.append(parts[0])
            return content_list

        content1 = extract_content(lines1)
        content2 = extract_content(lines2)

        # Combine both files
        combined_content = content1 + content2

        # Count occurrences across both files
        counter = Counter(combined_content)

        # Find duplicates that appear more than once (across both files)
        duplicates = [item for item, count in counter.items() if count > 1]

        # Display results
        if duplicates:
            print("Duplicates found:")
            for duplicate in duplicates:
                print(duplicate)
        else:
            print("No duplicates found.")

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1' and duplicates:
            save_results(duplicates, "duplicates_2files")
        # Immediately return to menu after saving (both Yes and No)
        # If user chooses "2" (No), immediately return to menu without prompt

    except Exception as e:
        print(f"Error reading files: {e}")


def remove_passwords():
    """Remove passwords from username:password format, keeping only usernames."""
    # Create file dialog for file selection
    print("Select accounts file...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select accounts file",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    # Check if user cancelled the dialog
    if not file_path:
        return

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    try:
        # Read the file
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        # Extract usernames (remove passwords and line numbers)
        usernames = []
        for line in lines:
            line = line.strip()
            if line:
                # Split by tab or space and take the last part as content
                parts = line.split('\t') if '\t' in line else line.split(None, 1)
                if len(parts) > 1:
                    content = parts[1]
                else:
                    content = parts[0]

                # Remove password (everything after and including :)
                if ':' in content:
                    username = content.split(':')[0]
                    usernames.append(username)
                else:
                    # If no colon found, keep the whole content as username
                    usernames.append(content)

        # Display results
        if usernames:
            print(f"Usernames ({len(usernames)} found):")
            for username in usernames:
                print(username)
        else:
            print("No usernames found.")

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1' and usernames:
            save_results(usernames, "usernames")
        # Immediately return to menu after saving (both Yes and No)
        # If user chooses "2" (No), immediately return to menu without prompt

    except Exception as e:
        print(f"Error reading file: {e}")


def find_non_duplicates():
    """Find non-duplicates (unique items) in a text file."""
    # Create file dialog for file selection
    print("Select file...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select a text file",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    # Check if user cancelled the dialog
    if not file_path:
        return

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    try:
        # Read the file and extract content
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        # Extract the content part (after the first tab/space if present)
        content_list = []
        for line in lines:
            line = line.strip()
            if line:
                # Split by tab or space and take the last part as content
                parts = line.split('\t') if '\t' in line else line.split(None, 1)
                if len(parts) > 1:
                    content_list.append(parts[1])
                else:
                    content_list.append(parts[0])

        # Count occurrences
        counter = Counter(content_list)

        # Find non-duplicates (items that appear only once)
        non_duplicates = [item for item, count in counter.items() if count == 1]

        # Display results
        if non_duplicates:
            print(f"Non-duplicates ({len(non_duplicates)} found):")
            for non_duplicate in non_duplicates:
                print(non_duplicate)
        else:
            print("No non-duplicates found.")

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1' and non_duplicates:
            save_results(non_duplicates, "non_duplicates")
        # Immediately return to menu after saving (both Yes and No)
        # If user chooses "2" (No), immediately return to menu without prompt

    except Exception as e:
        print(f"Error reading file: {e}")


def find_non_duplicates_two_files():
    """Find non-duplicates (unique items) between two text files."""
    # Select first file
    print("Select file 1...")
    root1 = tk.Tk()
    root1.withdraw()
    root1.attributes('-topmost', True)

    file_path1 = filedialog.askopenfilename(
        title="Select .txt file 1",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root1.destroy()

    # Check if user cancelled the dialog
    if not file_path1:
        return

    # Check if file exists
    if not os.path.exists(file_path1):
        print(f"Error: File 1 not found.")
        return

    # Select second file
    print("Select file 2...")
    root2 = tk.Tk()
    root2.withdraw()
    root2.attributes('-topmost', True)

    file_path2 = filedialog.askopenfilename(
        title="Select .txt file 2",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root2.destroy()

    # Check if user cancelled the dialog
    if not file_path2:
        return

    # Check if file exists
    if not os.path.exists(file_path2):
        print(f"Error: File 2 not found.")
        return

    try:
        # Read both files and extract content
        with open(file_path1, 'r', encoding='utf-8') as f:
            lines1 = f.readlines()

        with open(file_path2, 'r', encoding='utf-8') as f:
            lines2 = f.readlines()

        if not lines1:
            print(f"Error: File 1 is empty.")
            return

        if not lines2:
            print(f"Error: File 2 is empty.")
            return

        # Extract content from both files
        def extract_content(lines):
            content_list = []
            for line in lines:
                line = line.strip()
                if line:
                    # Split by tab or space and take the last part as content
                    parts = line.split('\t') if '\t' in line else line.split(None, 1)
                    if len(parts) > 1:
                        content_list.append(parts[1])
                    else:
                        content_list.append(parts[0])
            return content_list

        content1 = extract_content(lines1)
        content2 = extract_content(lines2)

        # Combine both files
        combined_content = content1 + content2

        # Count occurrences across both files
        counter = Counter(combined_content)

        # Find non-duplicates (items that appear only once across both files)
        non_duplicates = [item for item, count in counter.items() if count == 1]

        # Display results
        if non_duplicates:
            print(f"Non-duplicates found ({len(non_duplicates)} items appear once):")
            for non_duplicate in non_duplicates:
                print(non_duplicate)
        else:
            print("No non-duplicates found.")

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1' and non_duplicates:
            save_results(non_duplicates, "non_duplicates_2files")
        # Immediately return to menu after saving (both Yes and No)
        # If user chooses "2" (No), immediately return to menu without prompt

    except Exception as e:
        print(f"Error reading files: {e}")


def split_file_evenly():
    """Split a text file into two files evenly by lines."""
    # Create file dialog for file selection
    print("Select file to split...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select a text file to split",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    # Check if user cancelled the dialog
    if not file_path:
        return

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    try:
        # Read the file
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        total_lines = len(lines)
        mid_point = total_lines // 2

        # If odd number of lines, first file gets the extra line
        first_half = lines[:mid_point + (total_lines % 2)]
        second_half = lines[mid_point + (total_lines % 2):]

        # Get the base filename without extension
        base_name = os.path.splitext(os.path.basename(file_path))[0]

        # Create output filenames in the output directory
        timestamp = datetime.now().strftime("%m%d%Y_%H%M%S")
        file1_name = f"{base_name}_part1_{timestamp}.txt"
        file2_name = f"{base_name}_part2_{timestamp}.txt"

        file1_path = os.path.join(OUTPUT_DIR, file1_name)
        file2_path = os.path.join(OUTPUT_DIR, file2_name)

        # Write first half
        with open(file1_path, 'w', encoding='utf-8') as f:
            f.writelines(first_half)

        # Write second half
        with open(file2_path, 'w', encoding='utf-8') as f:
            f.writelines(second_half)

        # Display results
        print(f"\nFile split successfully!")
        print(f"Original file: {total_lines} lines")
        print(f"Part 1: {len(first_half)} lines -> {file1_path}")
        print(f"Part 2: {len(second_half)} lines -> {file2_path}")

        input("\nPress Enter to continue...")

    except Exception as e:
        print(f"Error splitting file: {e}")
        input("\nPress Enter to continue...")


def split_by_number():
    """Split a text file into N evenly-sized files."""
    print("Select file to split...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select a text file to split",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    if not file_path:
        return

    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    n_input = input("Split into: ").strip()
    try:
        n = int(n_input)
    except ValueError:
        print("Error: Please enter a valid number.")
        return

    if n <= 0:
        print("Error: Number must be greater than 0.")
        return

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        total_lines = len(lines)

        if n > total_lines:
            print(f"Error: Cannot split {total_lines} lines into {n} files.")
            return

        # Even split with remainder distributed across the first chunks
        base_size = total_lines // n
        remainder = total_lines % n

        base_name = os.path.splitext(os.path.basename(file_path))[0]
        timestamp = datetime.now().strftime("%m%d%Y_%H%M%S")

        print(f"\nSplitting {total_lines} lines into {n} files...")

        start = 0
        for i in range(n):
            chunk_size = base_size + (1 if i < remainder else 0)
            chunk = lines[start:start + chunk_size]
            start += chunk_size

            out_name = f"{base_name}_part{i + 1}_{timestamp}.txt"
            out_path = os.path.join(OUTPUT_DIR, out_name)

            with open(out_path, 'w', encoding='utf-8') as f:
                f.writelines(chunk)

            print(f"Part {i + 1}: {len(chunk)} lines -> {out_path}")

        input("\nPress Enter to continue...")

    except Exception as e:
        print(f"Error splitting file: {e}")
        input("\nPress Enter to continue...")


def randomize_list():
    """Randomize the lines of a text file (useful for proxy scrambling)."""
    # Create file dialog for file selection
    print("Select file to randomize...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="Select a text file to randomize",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
    )

    root.destroy()

    # Check if user cancelled the dialog
    if not file_path:
        return

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found.")
        return

    try:
        # Read the file
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        if not lines:
            print("Error: File is empty.")
            return

        # Remove empty lines if any and strip newlines
        non_empty_lines = [line.rstrip() for line in lines if line.strip()]

        if not non_empty_lines:
            print("Error: File contains no content.")
            return

        # Randomize the lines
        randomized_lines = non_empty_lines.copy()
        random.shuffle(randomized_lines)

        # Display results
        print(f"\nOriginal file: {len(non_empty_lines)} lines")
        print(f"Randomized output:")
        for line in randomized_lines:
            print(line.rstrip())

        # Ask if user wants to save results
        print("\nWould you like to save these results?")
        print("1. Yes")
        print("2. No")
        save_choice = input("Choice: ").strip()

        if save_choice == '1':
            save_results(randomized_lines, "randomized")

    except Exception as e:
        print(f"Error reading file: {e}")


def display_menu():
    """Display the main menu."""
    clear_screen()
    print(f"\n  Brandon's MultiTool v{__version__}")
    print("  ===================")
    print("  1. Find Duplicates")
    print("  2. Find Duplicates in 2 Files")
    print("  3. Remove Passwords from Accounts")
    print("  4. Find Non-Duplicates")
    print("  5. Find Non-Duplicates in 2 Files")
    print("  6. Split File Evenly")
    print("  7. Split by #")
    print("  8. Randomize List")
    print("  9. Exit")
    print("  ===================")


def main():
    """
    Main application loop.
    """
    ensure_output_dir()
    while True:
        display_menu()

        choice = input("\nChoice: ").strip()

        if choice == '1':
            find_duplicates()
        elif choice == '2':
            find_duplicates_two_files()
        elif choice == '3':
            remove_passwords()
        elif choice == '4':
            find_non_duplicates()
        elif choice == '5':
            find_non_duplicates_two_files()
        elif choice == '6':
            split_file_evenly()
        elif choice == '7':
            split_by_number()
        elif choice == '8':
            randomize_list()
        elif choice == '9':
            print("\nGoodbye!")
            sys.exit(0)
        else:
            print("Invalid choice.")


if __name__ == "__main__":
    main()
