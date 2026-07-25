"""The words a share slug is built from.

Its own module, and nothing imports it except the generator. That separation is the
requirement (§7): *"slug resolution stays decoupled from the lexicon, so the word list can
change without migration."* A resolver that could see this file would eventually be tempted
to validate against it, and the day a word was retired every link containing it would stop
working.

**Authoring rules**, because a slug is read aloud over comms and pasted into a scrim channel:

* lowercase ASCII only, three to ten letters, no hyphens — the hyphen is the separator;
* no proper nouns, and no in-game jargon: a link should read the same to somebody who has
  never undocked;
* review the lists as a **cross product**, not as two lists. The failure mode is a *pair* —
  any adjective may land in front of any noun, and two innocent words can meet badly.

Both lists are exactly 256 long, which is what the slug's entropy is calculated from; a test
pins the count so shrinking one is a deliberate act rather than a stray edit.
"""

from __future__ import annotations

ADJECTIVES: tuple[str, ...] = (
    "amber", "ancient", "arctic", "autumn", "azure", "balmy", "blazing", "bold",
    "brave", "breezy", "bright", "brisk", "bronze", "calm", "candid", "carved",
    "chalky", "cheerful", "chilly", "civic", "classic", "clean", "clear", "clever",
    "cloudy", "cobalt", "coastal", "cool", "copper", "coral", "cosmic", "crimson",
    "crisp", "crystal", "curious", "daring", "dawnlit", "deep", "dense", "dewy",
    "distant", "downy", "dusky", "dusty", "eager", "early", "earthy", "eastern",
    "elder", "electric", "elegant", "ember", "emerald", "endless", "even", "evening",
    "faded", "faint", "fair", "fancy", "feathery", "fern", "fierce", "fiery",
    "fine", "firm", "flint", "floral", "flowing", "fluent", "foggy", "fond",
    "forest", "formal", "free", "fresh", "frosted", "frosty", "gallant", "gentle",
    "gilded", "glacial", "glad", "gleaming", "glossy", "golden", "graceful", "grand",
    "granite", "grassy", "gray", "great", "green", "hardy", "harvest", "hazel",
    "hazy", "hearty", "heather", "hidden", "high", "hollow", "honest", "humble",
    "husky", "icy", "indigo", "inland", "ivory", "jade", "jolly", "jovial",
    "keen", "kind", "lakeside", "lavender", "lawful", "lazy", "leafy", "level",
    "light", "lilac", "limber", "linen", "little", "lively", "lofty", "lone",
    "long", "loyal", "lucid", "lucky", "lunar", "lush", "maple", "marble",
    "marine", "meadow", "mellow", "merry", "midnight", "mighty", "mild", "milky",
    "mindful", "minty", "misty", "modest", "moonlit", "morning", "mossy", "muted",
    "narrow", "native", "neat", "nimble", "noble", "north", "northern", "novel",
    "oaken", "ocean", "olive", "opal", "open", "orange", "orderly", "outer",
    "pale", "patient", "peaceful", "pearl", "pebbled", "placid", "plain", "pleasant",
    "plum", "polar", "polished", "prairie", "primal", "pristine", "proper", "proud",
    "pure", "purple", "quaint", "quick", "quiet", "rapid", "ready", "regal",
    "restful", "rich", "rippling", "river", "roaming", "robust", "rocky", "rosy",
    "rough", "round", "royal", "ruby", "rugged", "rustic", "sable", "sandy",
    "sapphire", "scarlet", "seaside", "secret", "serene", "shady", "shallow", "sharp",
    "sheer", "shining", "silent", "silken", "silver", "simple", "sleek", "slender",
    "smooth", "snowy", "soft", "solar", "solemn", "solid", "southern", "spiced",
    "spring", "spruce", "stalwart", "starry", "steady", "steep", "stellar", "still",
    "stony", "stormy", "stout", "sturdy", "summer", "sunlit", "sunny", "swift",
    "tall", "tame", "tawny", "teal", "tender", "thriving", "tidal", "tidy",
)

NOUNS: tuple[str, ...] = (
    "acorn", "alcove", "alder", "almond", "anchor", "anthem", "anvil", "apex",
    "apple", "arbor", "arch", "aria", "arrow", "ash", "aspen", "aster",
    "atlas", "aurora", "avenue", "azalea", "badge", "banner", "basin", "bay",
    "beacon", "beam", "bell", "birch", "bloom", "bluff", "bough", "boulder",
    "bramble", "branch", "breeze", "bridge", "brook", "burrow", "cabin", "cairn",
    "canal", "candle", "canopy", "canyon", "cape", "cavern", "cedar", "chapel",
    "chime", "cinder", "cliff", "cloud", "clover", "coast", "comet", "compass",
    "coral", "cove", "crater", "creek", "crest", "crown", "current", "dagger",
    "dawn", "delta", "dune", "dusk", "echo", "ember", "estuary", "falcon",
    "fathom", "feather", "fern", "field", "fjord", "flame", "flint", "forest",
    "forge", "fountain", "fox", "frost", "gale", "garden", "gate", "geyser",
    "glacier", "glade", "glimmer", "granite", "grotto", "grove", "gulf", "harbor",
    "harvest", "haven", "hawk", "headland", "hearth", "heath", "hedge", "hill",
    "hollow", "horizon", "ibis", "inlet", "iris", "island", "ivory", "jasper",
    "journey", "keel", "kestrel", "lagoon", "lake", "lantern", "larch", "ledge",
    "lichen", "lily", "linden", "lodge", "lookout", "lotus", "lumen", "lupine",
    "lyric", "manor", "maple", "marsh", "meadow", "mesa", "meteor", "mill",
    "mirror", "mist", "moor", "morrow", "mosaic", "moss", "moth", "mountain",
    "mural", "nectar", "nest", "nettle", "oak", "oasis", "orchard", "orchid",
    "osprey", "otter", "outlook", "palm", "pasture", "path", "peak", "pebble",
    "pennant", "petal", "pier", "pigment", "pillar", "pine", "pinnacle", "plateau",
    "plume", "pond", "poplar", "prairie", "prism", "quarry", "quill", "rain",
    "rampart", "raven", "reef", "reed", "ridge", "rill", "ripple", "river",
    "rook", "root", "rose", "sable", "saddle", "sage", "sail", "sanctum",
    "sandbar", "sapling", "scarp", "sequoia", "shale", "shelter", "shore", "signal",
    "silo", "sky", "slate", "slope", "solstice", "sorrel", "spark", "sparrow",
    "spire", "spring", "spruce", "stag", "stanza", "star", "stream", "summit",
    "sundial", "swallow", "sycamore", "tarn", "teal", "thicket", "thistle", "thorn",
    "thrush", "tide", "timber", "torrent", "tower", "trail", "trellis", "tundra",
    "valley", "vane", "vault", "verge", "vessel", "vine", "vista", "wagon",
    "warren", "watch", "waterfall", "wave", "willow", "window", "wing", "woodland",
    "wren", "yarrow", "yew", "zenith", "zephyr", "quartz", "obelisk", "cascade",
)
