# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Liste" is a simple web-based checklist management tool. Users create named lists with rows (tasks/items) and can dynamically add columns to track status. The project concept is described in `idee.md` (German).

### Core Concepts

- **Lists**: Named collections of rows. Created via a "New" action with a name and line-separated row values.
- **Table structure**: First column is an auto-incrementing counter, second column holds the row values provided at creation. Additional columns can be added dynamically.
- **Status values**: Cells accept "offen" (open), "erledigt" (done), "in Arbeit" (in progress).
- **Comments column**: Each row has a comment field tracking when last completed (and eventually by whom).
- **Description field**: A general markdown-capable input field for task descriptions.

### Technical Requirements (from idee.md)

- Accessible (barrierefreies) design
- Simple HTML, minimal or no framework
- If a framework is used, prefer Laravel
- No authentication required initially
- Language of the UI should be German
