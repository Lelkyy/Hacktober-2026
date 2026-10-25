Triton Trails
UCSD campus navigation

We've all gotten lost on campus at some point. Google Maps doesn't show the campus footpaths, and there's no good way to plan a route if you commute by bike, because it doesn't know the bike paths on campus either.

This project is a campus navigation app: enter your classes and it shows you the way, using the paths, stairs and bike paths students actually use.


What it does
Four ways to get there: Walk, No stairs (step-free), Bike (bike paths and bike lanes first, roads where needed, always on the right with the traffic, walking your bike only where riding isn't allowed), and Transit: campus shuttles, MTS buses and the Blue Line trolley on their real timetables. Like Google Maps, Transit lists up to three options, the shortest trip first (with times, lines, walking, transfers, "every N min", fare, free with the UCSD U-Pass), with Leave now / Depart at / Arrive by and a wheelchair-accessible option.
Your schedule: add a course from the Fall 2026 schedule by picking a lecture, then one of its discussions or labs (each option says what it would overlap); midterms and the final come with it. Tap any class for directions, change a section, undo a removal, see a week view, add your own events, export/import a backup. Saved in your browser.
Leave-by times: for your next class, in whichever mode you picked.
Every classroom: 556 rooms across 84 building codes are mapped to buildings; the few that aren't are listed with the reason.
Live directions: press Start for turn-by-turn navigation that follows your GPS ("In 120 ft, turn left onto Library Walk"), re-routes when you go off course, can speak instructions, and keeps the screen on.
Inside the building: which door to use, whether there's an elevator, and roughly which floor the room is on. Starting inside a building, the route leaves by one of its doors (traced from where walkways meet it, where no door is mapped).
Your whole day: see any day's classes in order, how long each walk between them takes and whether the gap is enough, and get directions to any class, from where you are, from the class before, or from home. With a home saved, the day starts with when to leave home and ends with when you'll be back. Overlapping classes show as a conflict to choose from, and the day's walks (and trips home) are drawn on the map.
Paths OSM doesn't have: courtyards, building-side walks, plazas and trails traced from UC San Diego's surveyed ground plan. Walks keep off bike paths unless they save real time, and never follow a road with no sidewalk unless it's the only way there. Where two paths come close, a walk can cut across the lawn between them, but only when that saves a real part of the trip. Parking lots can be walked anywhere.
Two campus maps: the official campus map (district names and campus boundary) or UC San Diego's illustrated one, moved onto true positions (it's drawn ~4 m off) so routes sit on its walkways.
Live trolleys and buses: trolleys and buses around the map's view at their last GPS fix, with how long ago it was taken and which way they're going; tap one for its route ahead and next stop (needs an MTS real-time API key).
- We already have an API key
Stops. A Stops button on the map turns the stop logos on. They start off, and that choice is not remembered. Only stops that have a scheduled trip appear. Each stop is a square sitting on its own coordinate at every zoom. One line fills the square with that line's color and prints the name (30, 201, IL, or B for the Blue Line). Several lines share one square, split into vertical color stripes, with no names. If every line arrives from the same direction, a small arrow shows the way the bus is facing as it pulls in. If the lines disagree, there is no arrow.

Clicking a stop with several lines opens that square into a row of squares, one per line, each colored and labeled, still centered on the stop. The left panel opens with the stop name, a small striped square, and the scheduled times from the published timetable. Under an hour, a time reads "in 12 min". An hour or more reads "in 5 hr 32 min". If it is already due, it says "due".

When more than one line serves the stop, the panel has an All chip plus one chip per line (30, 41, 201, 921). All is selected at first and draws every line. Clicking a line draws only that line and filters the times to it. All brings every line back. Clicking the map off the stop, or clicking the same stop again, hides the lines and the panel.

Where published lines run on top of each other, they are drawn side by side. Two directions of the same route that share one track stay a single line.

Live buses and trolleys. Separate Trolleys and Buses buttons show the live fleet. A bus is a bus shape in that route's color, with the route number on it, not a circle. A trolley keeps the tram icon. The marker sits at the last GPS fix and jumps when a new fix arrives. A small arrow shows the direction it is heading, and a short age sits under the icon ("38s"). Tapping a bus or trolley draws the rest of its current trip, plus the part it has already traveled, and opens a card beside the vehicle so the card does not cover the line. The card names the route, how old the GPS fix is, the direction, and the next stop. Tapping it again, or closing the card, clears that route.

Colors. Trolleys and campus shuttles use their published colors. Each bus number gets its own color, so 201 and 202 are not the same red. 201 is purple and 921 is rust orange, because those two would otherwise look the same.
Stop logos. A stop is a rounded square with a thin white outline, not a circle. The square gets a little larger as you zoom in. One line fills the whole square in that line's color and prints the name in white: 30, 201, IL, or B for the Blue Line. Several lines stay one square, split into vertical stripes of each line's color, with no names on it. Clicking that stop opens the stripes into a row of squares side by side, one per line, each filled with its color and labeled with its name. The row stays centered on the stop. The open stop gets a green ring. A triangle arrow sits on the square and points the way a bus is facing as it arrives. The arrow uses the line color and has a white edge so it shows up on the map. It only appears when every line at that stop arrives from about the same direction, and it is hidden when you are zoomed far out unless that stop is the one you clicked.

Bus logos. A live bus is a side-view bus, not a circle and not the same square as a stop. The body is filled with that route's color, the windows are white, the route number is printed in white on the body, and there are two dark wheels. The whole bus is about 44 by 30 pixels. A live trolley is a smaller rounded square with a white tram icon, in the trolley's published color. Both get a small arrow in the vehicle's color when a heading is known, and a tiny white label underneath with how old the GPS fix is, such as 38s. The bus color matches the route: each bus number has its own color, campus shuttles and trolleys keep their official colors, 201 is purple, and 921 is rust orange.



Spin e-bikes and scooters: tap the spin button to see every Spin e-bike and scooter free to ride, with battery, range and directions.
Spin scooter trips: walk to the best free scooter, ride, park at a Spin hub or bike rack where Spin allows it, and walk on. Scooters keep to roads and bike paths, slow to 8 mph on shared paths, and are walked on footpaths, on Library Walk and the other walks UCSD bars them from, and through Spin's no-ride zones (any speed limits Spin sets are followed too).
Campus places: the 5 nearest restrooms, food spots, vending machines, water refill stations, study spots, bike racks, parking and more from UC San Diego's campus map, and directions to any of them.
Search that understands campus: "WLH 2001", "wlh2001", "CSE 11" (each section separately), "giesel" (typos and missing spaces are fine), building codes, old names and the names students use.
Home: save it once, and it's one tap from either search box.
Student place names: search "Revelle bus stop", "GTC" and other names students use. Name any spot yourself, and suggest names for everyone.
Report a problem: from any route or the footer, tap the spot on the map, pick what's wrong, and send it by email (prefilled with the location and details).
