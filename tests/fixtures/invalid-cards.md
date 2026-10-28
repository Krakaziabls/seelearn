---
topic: Testing/EdgeCases
---

# Invalid Syntax Flashcard Examples

This file contains deliberately invalid cards to test parser error detection and validation warnings.

@card
@front
Card with missing back section (only front).
@end

@card
@front
First front section
@front
Second front section (duplicate)
@back
Valid back
@end

@card
@front
Card missing end marker
