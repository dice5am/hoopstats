"""Coverage probe of nba_api BoxScoreMatchupsV3 (stratified sample: 40 random regular-season games per season, seed 7). Used for the matchup-source decision in MATCHUPS.md.
Reads only; ~110 s. Run from nba-phase1 with the venv. Output 2026-11-10: 159/160 games returned rows; 3,488 of 3,504 played rows matched; PTS exact for 80.2% of offensive players, 99.1% of points attributed; positionOff blank in 51.4% of rows."""
import time, random, json, pandas as pd, duckdb
from nba_api.stats.endpoints import boxscorematchupsv3
gm=duckdb.sql("select game_id, season from 'data/curated/game_meta.parquet' where game_id like '002%' ").df()
random.seed(7)
sample=[]
for s,x in gm.groupby('season'): sample+=random.sample(list(x.game_id),40)
box=duckdb.sql("select game_id, player_id, pts, min, status from 'data/curated/player_game_box.parquet' where status='played'").df()
out=[];errs=[]
for gid in sample:
    for attempt in range(2):
        try:
            d=boxscorematchupsv3.BoxScoreMatchupsV3(game_id=gid, timeout=40).get_data_frames()[0]; break
        except Exception as e:
            d=None; time.sleep(3)
    if d is None: errs.append(gid); continue
    d['gid']=gid; out.append(d); time.sleep(0.4)
D=pd.concat(out); D.to_parquet('/tmp/matchup_sample.parquet')
print('games sampled',len(sample),'errors',len(errs),'games with rows',D.gid.nunique())
a=D.groupby(['gid','personIdOff']).agg(mpts=('playerPoints','sum'),poss=('partialPossessions','sum')).reset_index()
a['personIdOff']=a.personIdOff.astype(str)
m=a.merge(box,left_on=['gid','personIdOff'],right_on=['game_id','player_id'],how='inner')
print('matched off players',len(m),'of played rows in sampled games',box[box.game_id.isin(D.gid.unique())].shape[0])
print('points match share exact:',(m.mpts==m.pts).mean(),' mean(mpts/pts) where pts>0:',(m.mpts/m.pts)[m.pts>0].mean(), 'sum ratio', m.mpts.sum()/m.pts.sum())
print('positionOff blank share',(D.positionOff.fillna('')=='').mean())
print(D.groupby(D.gid.str[:0]+D.gid.map(dict(zip(gm.game_id,gm.season)))).gid.nunique())
