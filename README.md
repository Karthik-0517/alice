# alice
A Python bot for the SpacetimeDB Scrabble auction game. strategy.py indexes your word list, scores words, tracks unseen tiles, bids on letters by their value to your rack, and decides when to play words. client.py polls the HTTP API to bid, play, and rejoin lobbies; its schema guesses need checking via --dump.
