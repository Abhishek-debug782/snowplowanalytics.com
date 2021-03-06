---
layout: post
title: Reprocessing bad rows of Snowplow data using Hive, the JSON Serde and Qubole
title-short: Reprocessing bad rows
tags: [hive, qubole, json, serde, reprocessing, data, taps]
author: Yali
category: Data insights 
permalink: /blog/2013/09/11/reprocessing-bad-data-using-hive-the-json-serde-and-qubole/
---

**This post is outdated. For more documentation on debugging and recovering bad rows, please visit:**

- [Debugging bad rows in Elasticsearch and Kibana](http://discourse.snowplowanalytics.com/t/debugging-bad-rows-in-elasticsearch-and-kibana-tutorial/28)
- [Debugging bad rows in Elasticsearch using curl (without Kibana)](http://discourse.snowplowanalytics.com/t/debugging-bad-rows-in-elasticsearch-using-curl-without-kibana-tutorial/143)
- [Snowplow 81 release post](http://snowplowanalytics.com/blog/2016/06/16/snowplow-r81-kangaroo-island-emu-released/) (for recovering bad rows)
- [Hadoop Event Recovery](https://github.com/snowplow/snowplow/tree/master/3-enrich/hadoop-event-recovery)

One of the distinguishing features of the Snowplow data pipeline is the handling of "bad" data. Every row of incoming, raw data is validated. When a row fails validation, it is logged in a "bad rows" bucket on S3 alongside the error message that was generated by the failed validation. That means you can keep track of the number of rows that fail validation, and have the opportunity to update and then reprocess those bad rows. (This makes Snowplow different from traditional web analytics platforms, that simply ignore bad rows of data, and provide no insight into the volume of incoming data that ends up being ignored.)

This functionality was crucial in spotting that, in mid-August, Amazon made an [undocumented update the CloudFront collector file format][cloudfront-update-post]. This resulted in a sudden spike in the number of "bad rows" generated by Snowplow, as the `cs-uri-query` field format changed from the format the Enrichment process expected. (For details of the change, see [this blog post][cloudfront-update-post], and the links in it.) Amazon has since rolled back the update, and we have since updated Snowplow to be able to process rows in both formats. However, Snowplow users will have three weeks of data with lines of data missing, that ideally need to be reprocessed using the updated Snowplow version.

<img src="/assets/img/blog/2013/09/black_sheep.jpg" title="black sheet - can you spot bad data?" width="300" />

In this blog post, we will walk through:

1. How to use [Apache Hive] [hive], [Qubole][qubole] and [Robert Congui's] [rcongui] [JSON serde][json-serde] to monitor the number of bad rows generated over time
2. How to use the same tools to reprocess the bad rows of data, so that they are added to your Snowplow data in Redshift / PostgreSQL

The steps necessary to reprocess the data will be very similar to those required regardless of the reason that the reprocessing is necessary: as a result, this blog post should be useful for anyone interested in using the bad rows functionality to debug and improve the robustness of their event data collection. It should also be useful for anyone interested in using [Hive] [hive] and the [JSON serde] [json-serde] to process JSON data in S3. (Bad row data is stored by Snowplow in JSON format.) We will use [Qubole] [qubole], our preferred platform for running Hive jobs on data in S3, which we previously introduced in [this blog post] [qubole-post].

1. [Understanding how Snowplow handles bad rows](#how-snowplow-handles-bad-rows)
2. [Processing the bad rows data using the JSON serde, Hive and Qubole](/blog/2013/09/11/reprocessing-bad-data-using-hive-the-json-serde-and-qubole/#processing-bad-rows-data-using-json-serde-hive-qubole)
3. [Plotting the number of bad rows over time](#plot-bad-rows-over-time)
4. [Reprocessing bad rows](#processing-bad-rows)

<!--more-->

<div class="html">
<a name="how-snowplow-handles-bad-rows"><h2>1. Understanding how Snowplow handles bad rows</h2></a>
</div>

The Snowplow enrichment process takes input lines of data, in the form of collector logs. It validates the format of the data in each of those lines. If the format is as expected, it performs the relevant enrichments on that data (e.g. referer parsing, geo-IP lookups), and writes the enriched data to the Out Bucket on S3, from where it can be loaded into Redshift / PostgreSQL. If the input line of data fails the validation, it gets written to the Bad Rows Bucket on S3.

![flow-chart] [flow-chart-diagram]

The locations are specified in the [EmrEtlRunner config file] [emretlrunner-config-file], an example of which can be found [here] [emretlrunner-config-file].

{% highlight yaml %}
:s3:
  :region: ADD HERE
  :buckets:
    :assets: s3://snowplow-hosted-assets # DO NOT CHANGE unless you are hosting the jarfiles etc yourself in your own bucket
    :log: ADD HERE
    :in: ADD HERE
    :processing: ADD HERE
    :out: ADD HERE WITH SUB-FOLDER # e.g. s3://my-out-bucket/events
    :out_bad_rows: ADD HERE # e.g. s3://my-out-bucket/bad-rows
    :out_errors: ADD HERE # Leave blank unless :continue_on_unexpected_error: set to true below
    :archive: ADD HERE
{% endhighlight %}

Each bad row is a JSON containing just two fields:

1. A field called `line` (of type String), which is the *raw* line of data from the collector log
2. A field called `errors` (an Array of Strings), which includes an error message for *every* validation test the line failed

An example row generated for the Snowplow website, caused by Amazon's CloudFront log file format update, is shown below (formatted to make it easier to read):

{% highlight json %}
{
    "line": "2013-08-19\t04:06:09\tHKG50\t826\t175.159.22.201\tGET\td3v6ndkyapxc2w.cloudfront.net\t/i\t200\thttp://snowplowanalytics.com/analytics/catalog-analytics/market-basket-analysis-identifying-products-that-sell-well-together.html\tMozilla/5.0%20(Macintosh;%20Intel%20Mac%20OS%20X%2010_6_8)%20AppleWebKit/534.57.2%20(KHTML,%20like%20Gecko)%20Version/5.1.7%20Safari/534.57.2\te=pv&page=Market%20basket%20analysis%20-%20identifying%20products%20and%20content%20that%20go%20well%20together%20-%20Snowplow%20Analytics&dtm=1376885168897&tid=479753&vp=1361x678&ds=1346x6578&vid=1&duid=24210ca58692c76e&p=web&tv=js-0.12.0&fp=421731260&aid=snowplowweb&lang=en-us&cs=UTF-8&tz=Asia%2FShanghai&refr=http%3A%2F%2Fwww.google.com%2Furl%3Fsa%3Dt%26rct%3Dj%26q%3Dmarket%2520basket%2520analysis%2520apriori%2520algorithm%26source%3Dweb%26cd%3D9%26sqi%3D2%26ved%3D0CGgQFjAI%26url%3Dhttp%253A%252F%252Fsnowplowanalytics.com%252Fanalytics%252Fcatalog-analytics%252Fmarket-basket-analysis-identifying-products-that-sell-well-together.html%26ei%3DnZkRUp_UF4qdiAem-YHwAg%26usg%3DAFQjCNE8XEB-2ItaXcOC5i2T-jLvpv77uQ%26sig2%3DFPZRScoJkUEg5G2qa8BoBA%26bvm%3Dbv.50768961%2Cd.aGc%26cad%3Drjt&f_pdf=1&f_qt=1&f_realp=0&f_wma=0&f_dir=0&f_fla=1&f_java=1&f_gears=0&f_ag=0&res=1440x900&cd=24&cookie=1&url=http%3A%2F%2Fsnowplowanalytics.com%2Fanalytics%2Fcatalog-analytics%2Fmarket-basket-analysis-identifying-products-that-sell-well-together.html\t-\tRefreshHit\tmEPXmPmaMHvqTD6ung3_IlOgVuNOLnliGz9mVYn29oyOPMDadhuQpQ==",
    "errors": [
        "Provided URI string [http://www.google.com/url?sa=t&rct=j&q=market basket analysis apriori algorithm&source=web&cd=9&sqi=2&ved=0CGgQFjAI&url=http://snowplowanalytics.com/analytics/catalog-analytics/market-basket-analysis-identifying-products-that-sell-well-together.html&ei=nZkRUp_UF4qdiAem-YHwAg&usg=AFQjCNE8XEB-2ItaXcOC5i2T-jLvpv77uQ&sig2=FPZRScoJkUEg5G2qa8BoBA&bvm=bv.50768961,d.aGc&cad=rjt] violates RFC 2396: [Illegal character in query at index 45: http://www.google.com/url?sa=t&rct=j&q=market basket analysis apriori algorithm&source=web&cd=9&sqi=2&ved=0CGgQFjAI&url=http://snowplowanalytics.com/analytics/catalog-analytics/market-basket-analysis-identifying-products-that-sell-well-together.html&ei=nZkRUp_UF4qdiAem-YHwAg&usg=AFQjCNE8XEB-2ItaXcOC5i2T-jLvpv77uQ&sig2=FPZRScoJkUEg5G2qa8BoBA&bvm=bv.50768961,d.aGc&cad=rjt]"
    ]
}
{% endhighlight %}

<div class="html">
<a name="processing-bad-rows-data-using-json-serde-hive-qubole"><h2>2. Processing the bad rows data using the JSON serde, Hive and Qubole</h2> </a>
</div>

There are a couple of ways to process JSON data in Hive. For this tutorial, we're going to use Roberto Congiu's [Hive-JSON-Serde] [json-serde]. This is our preferred method of working with JSONs in Hive, where your complete data set is stored as a series of JSONs. (When you have a single JSON-formatted field in a regular Hive table, we recommend using the `get_json_object` UDF to parse the JSON data.)

The Hive-JSON-serde is available [on Github] [json-serde] and can be built using Maven. If you prefer not to compile it for yourself, we have made a hosted version of the compiled JAR available [here] [json-serde-compiled-jar].

Now that we have placed the JSON serde in an S3 location that is accessible to us when we run Hive, we are in a position to fire up Qubole and start analyzing our bad rows data. Log into Qubole via the web UI to get started and open up the **Composer** window. (If you have not tried Qubole yet, we recommend you [read our guide to getting started with Qubole] [get-started-with-qubole].)

Now enter the following in the Qubole Composer:

	ADD JAR s3://snowplow-hosted-assets/third-party/rcongiu/json-serde-1.1.6-jar-with-dependencies.jar;

After a short period Qubole should alert you that the JAR has been successfully uploaded:

![qubole-pic-1] [q1-pic]

Now we need to define a table so that Hive can query our bad row data in S3. Execute the following query in the Qubole Composer, making sure that you update the `LOCATION` setting to point to the location in S3 where your bad rows are stored. (This can be worked out from your EmrEtlRunner's `config.yml` file, as explained [above](#how-snowplow-handles-bad-rows)).

{% highlight mysql %}
CREATE EXTERNAL TABLE `bad_rows` (
	line string,
	errors array<string>
)
PARTITIONED BY (run string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
STORED AS TEXTFILE
LOCATION 's3n://snowplow-data/snplow/bad-rows/';
{% endhighlight %}

![qubole-pic-2] [q2-pic]

Our table is partitioned by `run` - each time the Snowplow enrichment process is run (in our case daily), any bad rows are saved in their own separate subfolder labelled `run=2013-xx-xx...`. Let's recover those partitions, by executing the following:

{% highlight mysql %}
ALTER TABLE `bad_rows` RECOVER PARTITIONS;
{% endhighlight %}

<div class="html">
<a name="plot-bad-rows-over-time"><h2>3. Plotting the number of bad rows over time</h2></a>
</div>

We run the Snowplow ETL once a day. As a result, each "run" represents one days worth of data. By counting the number of bad rows per run, we effectively calculate the number of bad rows of data generated per day. We can do that by executing the following query:

{% highlight mysql %}
SELECT
run,
count(*)
FROM `bad_rows`
GROUP BY run;
{% endhighlight %}

![qubole-pic-3] [q3-pic]

Execute that in Qubole, and then download your results. (By clicking the **Download** link in the UI. If you open them in Excel, you should see something as follows:

| **Run ID**          | **Number of bad rows**   |
|:--------------------|--------------------------|
| 2013-08-17-03-00-02 | 6                        |
| 2013-08-18-03-00-03 | 2                        |
| 2013-08-19-03-00-03 | 3                        |
| ...                 | ...                      |

(We have added the headers to the table above - these will not be downloaded)

We can plot the data directly in Excel:

![excel-graph][excel-graph-1]

Notice:

* We have *no* bad rows before August 17th, when Amazon updated their Cloudfront log format
* We then have bad rows every day since. (In our case, this varies between 2-25. This is on the Snowplow site, which attracts c.200 uniques per day.)

<div class="html">
<a name="processing-bad-rows"><h2>4. Reprocessing bad rows</h2></a>
</div>

Using plots like the one above to spot emerging problems with your Snowplow data pipeline is one thing. When you've identified the cause of the problem, and fixed it (as we have), you then need to reprocess those bad lines of data.

Fortunately, this is pretty straightforward. We need to extract the bad lines out of the JSONs, and write them back into a new location in S3 in their raw form. We can then set the `IN` bucket on the EmrEtlRunner to point to this new location, and run the updated Enrichment process on the data.

To extract the raw lines of data out of the JSONs, we first create another external table in Hive, this time in the location where we will save the data to be reprocessed:

{% highlight mysql %}
CREATE EXTERNAL TABLE `data_to_reprocess` (
	line string  
)
ROW FORMAT DELIMITED
LINES TERMINATED BY '\n'
STORED AS TEXTFILE
LOCATION 's3n://qubole-analysis/data-to-reprocess/snplow/2013-09-11/';
{% endhighlight %}

Note:

* We've created our table in the special bucket that we've given Qubole unrestricted write access to
* We've created a specific folder in that bucket for the new data, so it will be easy to find later

Now that we've created our table, we need to insert into it the bad rows to reprocess:

{% highlight mysql %}
INSERT INTO TABLE `data_to_reprocess`
SELECT line
FROM `bad_rows`;
{% endhighlight %}

Note how we are **only** writing the actual raw line of data into the new table (and ignoring everything else in the `bad_rows` table, including both the `run` and the actual error message itself).

Bingo! When the query is complete, the data to reprocess is available in the new bucket we've created:

![s3-pic][s3-pic]

We now need to run the Snowplow Enrichment process on this new data set. We do that using EmrEtlRunner. Navigate to the server you run EmrEtlRunner from, and navigate to the directory it is installed in.

Now, create a copy of your [EmrEtlRunner config.yml] [emretlrunner-config-file] with a suitable name e.g. `config-process-bad-rows-2013-09-11.yml` and update the In Bucket to point to the location of the the data to be reprocessed is (i.e. the location of the Hive `data_to_reprocess` table). Don't forget as well to update (if you haven't already done so) the ETL to the latest version, which can handle the change in Amazon's CloudFront log file format:

{% highlight yaml %}
:snowplow:
  :hadoop_etl_version: 0.3.4 # Version of the Hadoop ETL
{% endhighlight %}

Now execute the following command at the command line:

{% highlight bash %}
$ bundle exec bin/snowplow-emr-etl-runner --config config/config-process-bad-rows-2013-09-11.yml
{% endhighlight %}

Make sure you update the path to point at the name of the config file you created in the previous step. This should kick off the Enrichment process in EMR. Once it has been completed, you can run the StorageLoader to load the newly processed data into Redshift / PostgreSQL as normal:

{% highlight bash %}
$ cd ../../4-storage/storage-loader
$ bundle exec bin/snowplow-storage-loader --config config/config.yml
{% endhighlight %}

Done! The data that was previously excluded has now been added to your Snowplow database!

[cloudfront-update-post]: /blog/2013/09/05/snowplow-0.8.9-released-to-handle-cloudfront-log-file-format-change/
[qubole-post]: /blog/2013/09/03/using-qubole-to-analyze-snowplow-web-data/
[hive]: http://hive.apache.org/
[qubole]: http://www.qubole.com/

[json-serde]: https://github.com/rcongiu/Hive-JSON-Serde
[rcongui]: https://github.com/rcongiu
[json-serde-compiled-jar]: http://snowplow-hosted-assets.s3.amazonaws.com/third-party/rcongiu/json-serde-1.1.6-jar-with-dependencies.jar

[emretlrunner-config-file]: https://github.com/snowplow/snowplow/blob/master/3-enrich/emr-etl-runner/config/config.yml.sample
[black-sheep]: /assets/img/blog/2013/09/black_sheep.jpg
[flow-chart-diagram]: /assets/img/blog/2013/09/snowplow-data-processing-bad-bucket-flow-chart-cropped.png

[get-started-with-qubole]: https://github.com/snowplow/snowplow/wiki/Setting-up-Qubole-to-analyze-Snowplow-data-using-Apache-Hive
[q1-pic]: /assets/img/blog/2013/09/qubole-add-jar.png
[q2-pic]: /assets/img/blog/2013/09/qubole-create-table.png
[q3-pic]: /assets/img/blog/2013/09/qubole-execute-count-query.png
[excel-graph-1]: /assets/img/blog/2013/09/excel-graph-of-bad-rows-per-day.JPG
[s3-pic]: /assets/img/blog/2013/09/file_with_lines_of_data_to_reprocess.png
